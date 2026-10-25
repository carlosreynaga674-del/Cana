import { createHash, randomUUID } from "node:crypto";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NOTIFICATIONS = 10_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const descriptions = {
  member_registered: {
    title: "New membership application",
    message: "A new member account was created. Open the member record for its current application status.",
    target: "members",
  },
  verification_requested: {
    title: "Verification requested",
    message: "A member submitted information for private identity review.",
    target: "age",
  },
  verification_reviewed: {
    title: "Verification review updated",
    message: "A member's application review status was updated.",
    target: "age",
  },
  member_profile_updated: {
    title: "Member profile updated",
    message: "A member updated their profile. Open the member record for current details.",
    target: "members",
  },
};

/** Private account activity, with independent durable read receipts for each staff identity. */
export function createStaffNotifications({ db, HttpError, now = Date.now } = {}) {
  if (!db || !HttpError) throw new TypeError("A database and HTTP error type are required.");
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_notifications (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('member_registered','verification_requested','verification_reviewed','member_profile_updated')),
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(type,source_hash)
    );
    CREATE INDEX IF NOT EXISTS staff_notifications_created ON staff_notifications(created_at);
    CREATE INDEX IF NOT EXISTS staff_notifications_member ON staff_notifications(member_id);
    CREATE TABLE IF NOT EXISTS staff_notification_reads (
      notification_id TEXT NOT NULL REFERENCES staff_notifications(id) ON DELETE CASCADE,
      principal_ref TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY(principal_ref,notification_id)
    );
    CREATE INDEX IF NOT EXISTS staff_notification_reads_event ON staff_notification_reads(notification_id);
  `);
  let closed = false;
  const stamp = () => new Date(now()).toISOString();
  const byId = db.prepare("SELECT id,sequence,member_id FROM staff_notifications WHERE id=?");
  const bySource = db.prepare("SELECT id,sequence,member_id FROM staff_notifications WHERE type=? AND source_hash=?");
  // Defer statements that validate foreign keys until the members schema exists.
  const mutationStatements = new Map();
  function mutation(sql) {
    if (!mutationStatements.has(sql)) mutationStatements.set(sql, db.prepare(sql));
    return mutationStatements.get(sql);
  }

  function ensureOpen() {
    if (closed) throw new HttpError(503, "Notifications are unavailable.");
  }
  function principalRef(principal) {
    if (typeof principal !== "string" || !/^(?:admin|staff):[A-Za-z0-9_.-]{1,128}$/.test(principal))
      throw new HttpError(403, "A valid staff identity is required.");
    return hash(principal);
  }
  function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, label } = {}) {
    if ((typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) ||
        !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum)
      throw new HttpError(422, `Choose a valid ${label || "notification value"}.`);
    return Number(value);
  }
  function cleanup() {
    mutation("DELETE FROM staff_notifications WHERE created_at<=?")
      .run(new Date(now() - RETENTION_MS).toISOString());
    mutation("DELETE FROM staff_notifications WHERE sequence IN (SELECT sequence FROM staff_notifications ORDER BY sequence DESC LIMIT -1 OFFSET ?)")
      .run(MAX_NOTIFICATIONS);
  }
  function transaction(action) {
    ensureOpen();
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      if (ownsTransaction) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (ownsTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
  function publish(body) {
    ensureOpen();
    if (!record(body) || Object.keys(body).some((key) => !["type", "memberId", "sourceRef"].includes(key)) ||
        typeof body.type !== "string" || !Object.hasOwn(descriptions, body.type) || typeof body.memberId !== "string" ||
        !body.memberId.length || body.memberId.length > 80 || typeof body.sourceRef !== "string" ||
        !body.sourceRef.trim() || body.sourceRef.length > 512)
      throw new HttpError(422, "Choose a valid member notification.");
    const sourceHash = hash(body.sourceRef);
    return transaction(() => {
      cleanup();
      if (!db.prepare("SELECT id FROM members WHERE id=?").get(body.memberId))
        throw new HttpError(404, "Member not found.");
      const existing = bySource.get(body.type, sourceHash);
      if (existing) {
        if (existing.member_id !== body.memberId)
          throw new HttpError(409, "This notification source belongs to another member.");
        return { id: existing.id, sequence: existing.sequence };
      }
      const id = randomUUID();
      mutation("INSERT INTO staff_notifications (id,type,member_id,source_hash,created_at) VALUES (?,?,?,?,?)")
        .run(id, body.type, body.memberId, sourceHash, stamp());
      cleanup();
      const event = byId.get(id);
      return { id: event.id, sequence: event.sequence };
    });
  }
  function list(principal, options = {}) {
    ensureOpen();
    const principalHash = principalRef(principal);
    if (!record(options)) throw new HttpError(422, "Choose valid notification filters.");
    const { limit = "30", before = "", unreadOnly = false } = options;
    const pageSize = integer(limit, { minimum: 1, maximum: 50, label: "notification page size" });
    const cursor = before === "" ? null : integer(before, { minimum: 1, label: "notification cursor" });
    if (typeof unreadOnly !== "boolean") throw new HttpError(422, "Choose a valid unread filter.");
    return transaction(() => {
      cleanup();
      const counts = db.prepare(`
        SELECT COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN r.notification_id IS NULL THEN 1 ELSE 0 END),0) AS unread_count,
          COALESCE(MAX(n.sequence),0) AS latest_sequence
        FROM staff_notifications n
        LEFT JOIN staff_notification_reads r ON r.notification_id=n.id AND r.principal_ref=?
      `).get(principalHash);
      const conditions = [
        ...(cursor === null ? [] : ["n.sequence<?"]),
        ...(unreadOnly ? ["r.notification_id IS NULL"] : []),
      ];
      const rows = db.prepare(`
        SELECT n.id,n.sequence,n.type,n.member_id,n.created_at,m.name AS member_name,r.read_at
        FROM staff_notifications n JOIN members m ON m.id=n.member_id
        LEFT JOIN staff_notification_reads r ON r.notification_id=n.id AND r.principal_ref=?
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY n.sequence DESC LIMIT ?
      `).all(principalHash, ...(cursor === null ? [] : [cursor]), pageSize + 1);
      const hasMore = rows.length > pageSize;
      const page = rows.slice(0, pageSize);
      return {
        notifications: page.map((row) => ({
          id: row.id, sequence: row.sequence, type: row.type, ...descriptions[row.type],
          memberId: row.member_id, memberName: row.member_name,
          createdAt: row.created_at, readAt: row.read_at || null,
        })),
        unreadCount: counts.unread_count,
        total: unreadOnly ? counts.unread_count : counts.total,
        nextCursor: hasMore ? String(page.at(-1).sequence) : null,
        latestSequence: counts.latest_sequence,
      };
    });
  }
  function markRead(principal, id) {
    ensureOpen();
    const principalHash = principalRef(principal);
    if (typeof id !== "string" || !UUID.test(id))
      throw new HttpError(422, "Choose a valid notification.");
    return transaction(() => {
      cleanup();
      if (!byId.get(id)) throw new HttpError(404, "Notification not found.");
      mutation("INSERT INTO staff_notification_reads (notification_id,principal_ref,read_at) VALUES (?,?,?) ON CONFLICT(principal_ref,notification_id) DO NOTHING")
        .run(id, principalHash, stamp());
      return { ok: true };
    });
  }
  function markAllRead(principal, body) {
    ensureOpen();
    const principalHash = principalRef(principal);
    if (!record(body) || Object.keys(body).some((key) => key !== "through"))
      throw new HttpError(422, "Choose a valid notification read boundary.");
    const through = integer(body.through, { label: "notification read boundary" });
    return transaction(() => {
      cleanup();
      db.prepare(`
        INSERT INTO staff_notification_reads (notification_id,principal_ref,read_at)
        SELECT id,?,? FROM staff_notifications WHERE sequence<=?
        ON CONFLICT(principal_ref,notification_id) DO NOTHING
      `).run(principalHash, stamp(), through);
      return { ok: true };
    });
  }
  function maintain() {
    // Maintenance must never borrow or commit an unrelated caller's transaction.
    if (closed) return;
    try {
      if (db.isTransaction) return;
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='members'").get()) return;
      transaction(cleanup);
    } catch {
      // Retry on the next tick or request without logging private account data.
    }
  }
  maintain();
  const cleanupTimer = setInterval(maintain, 60 * 60 * 1000);
  cleanupTimer.unref?.();
  return {
    publish, list, markRead, markAllRead,
    close() { closed = true; clearInterval(cleanupTimer); },
  };
}
