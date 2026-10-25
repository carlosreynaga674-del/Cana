import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStaffNotifications } from "../server/notifications.mjs";

const DAY = 24 * 60 * 60 * 1000;
const ADMIN = "admin:admin";
const STAFF = `staff:${randomUUID()}`;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const errorStatus = (status) => (error) => error instanceof HttpError && error.status === status;

test("a fresh notification schema can initialize before the member subsystem creates its tables", (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const notifications = createStaffNotifications({ db, HttpError });
  t.after(() => { notifications.close(); db.close(); });
  db.exec("CREATE TABLE members(id TEXT PRIMARY KEY,name TEXT NOT NULL)");
  const memberId = randomUUID();
  db.prepare("INSERT INTO members VALUES (?,?)").run(memberId, "New Install Member");
  notifications.publish({ type: "member_registered", memberId, sourceRef: memberId });
  assert.equal(notifications.list(ADMIN).notifications[0].memberName, "New Install Member");
});

function database(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      password_hash TEXT DEFAULT 'private-local-password-hash',
      birth_date TEXT DEFAULT '2000-01-01'
    );`);
  return db;
}
function fixture(t, options = {}) {
  const db = database();
  const notifications = createStaffNotifications({ db, HttpError, ...options });
  t.after(() => { notifications.close(); db.close(); });
  const add = (extra = {}) => {
    const member = { id: randomUUID(), name: "Local Member", email: `${randomUUID()}@example.test`, ...extra };
    db.prepare("INSERT INTO members(id,name,email) VALUES (?,?,?)").run(member.id, member.name, member.email);
    return member;
  };
  const publish = (member, type = "member_registered", sourceRef = randomUUID()) =>
    notifications.publish({ memberId: member.id, type, sourceRef });
  return { db, notifications, add, publish };
}

test("account notifications deduplicate committed events without storing identity details or raw source references", (t) => {
  const f = fixture(t);
  const member = f.add({ name: "Private Full Name", email: "private-source@example.test" });
  const sourceRef = `${member.email}:private-upload-reference`;
  const first = f.publish(member, "member_registered", sourceRef);
  assert.match(first.id, /^[a-f0-9-]{36}$/);
  assert.ok(Number.isInteger(first.sequence) && first.sequence > 0);
  assert.deepEqual(f.publish(member, "member_registered", sourceRef), first);
  const anotherType = f.publish(member, "member_profile_updated", sourceRef);
  assert.notEqual(anotherType.id, first.id);
  const rows = f.db.prepare("SELECT * FROM staff_notifications").all();
  assert.equal(rows.length, 2);
  const stored = JSON.stringify(rows);
  for (const privateValue of [member.name, member.email, sourceRef, "private-local-password-hash", "2000-01-01"])
    assert.equal(stored.includes(privateValue), false);
  assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.source_hash)));
  const feed = f.notifications.list(ADMIN);
  assert.equal(feed.notifications[0].memberName, member.name);
  assert.equal(feed.notifications[0].target, "members");
  assert.equal(JSON.stringify(feed).includes(member.email), false);
  f.db.prepare("UPDATE members SET name=? WHERE id=?").run("Current Member Name", member.id);
  assert.equal(f.notifications.list(ADMIN).notifications[0].memberName, "Current Member Name");
});

test("new event creation joins the caller transaction and never backfills historical accounts", (t) => {
  const f = fixture(t);
  f.add();
  assert.equal(f.notifications.list(ADMIN).total, 0);
  f.db.exec("BEGIN IMMEDIATE");
  const uncommitted = f.add();
  f.publish(uncommitted);
  f.db.exec("ROLLBACK");
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notifications").get().total, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM members WHERE id=?").get(uncommitted.id).total, 0);
  const committed = f.add();
  f.db.exec("BEGIN IMMEDIATE");
  const event = f.publish(committed);
  f.db.exec("COMMIT");
  assert.equal(f.notifications.list(ADMIN).notifications[0].id, event.id);
});

test("each workforce identity keeps independent unread receipts and repeated reads preserve the first timestamp", (t) => {
  let clock = Date.now();
  const f = fixture(t, { now: () => clock });
  const member = f.add();
  const event = f.publish(member, "verification_requested");
  assert.equal(f.notifications.list(ADMIN).unreadCount, 1);
  assert.equal(f.notifications.list(STAFF).unreadCount, 1);
  assert.deepEqual(f.notifications.markRead(ADMIN, event.id), { ok: true });
  const firstRead = f.notifications.list(ADMIN).notifications[0].readAt;
  assert.ok(firstRead);
  clock += 1000;
  f.notifications.markRead(ADMIN, event.id);
  assert.equal(f.notifications.list(ADMIN).notifications[0].readAt, firstRead);
  assert.equal(f.notifications.list(ADMIN).unreadCount, 0);
  assert.equal(f.notifications.list(STAFF).unreadCount, 1);
  f.notifications.markRead(STAFF, event.id);
  assert.equal(f.notifications.list(STAFF).unreadCount, 0);
  const receipts = f.db.prepare("SELECT * FROM staff_notification_reads").all();
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every((receipt) => /^[a-f0-9]{64}$/.test(receipt.principal_ref)));
  assert.equal(JSON.stringify(receipts).includes(STAFF), false);
});

test("cursor pagination remains stable when later account events arrive and unread filtering reports the whole matching feed", (t) => {
  const f = fixture(t);
  const member = f.add();
  const events = Array.from({ length: 5 }, () => f.publish(member, "member_profile_updated"));
  const first = f.notifications.list(ADMIN, { limit: "2" });
  assert.deepEqual(first.notifications.map((event) => event.id), [events[4].id, events[3].id]);
  assert.equal(first.nextCursor, String(events[3].sequence));
  assert.equal(first.total, 5);
  assert.equal(first.latestSequence, events[4].sequence);
  const newest = f.publish(member, "verification_reviewed");
  const next = f.notifications.list(ADMIN, { limit: 2, before: first.nextCursor });
  assert.deepEqual(next.notifications.map((event) => event.id), [events[2].id, events[1].id]);
  assert.equal(next.total, 6);
  assert.equal(next.latestSequence, newest.sequence);
  f.notifications.markRead(ADMIN, newest.id);
  const unread = f.notifications.list(ADMIN, { limit: 2, unreadOnly: true });
  assert.equal(unread.total, 5);
  assert.equal(unread.unreadCount, 5);
  assert.ok(unread.notifications.every((event) => event.readAt === null));
  assert.equal(unread.notifications[0].id, events[4].id);
  const last = f.notifications.list(ADMIN, { before: String(events[1].sequence) });
  assert.deepEqual(last.notifications.map((event) => event.id), [events[0].id]);
  assert.equal(last.nextCursor, null);
});

test("mark all read stops at the viewed sequence and never silently consumes a newly arriving notification", (t) => {
  const f = fixture(t);
  const member = f.add();
  f.publish(member);
  const viewed = f.notifications.list(ADMIN);
  const arriving = f.publish(member, "verification_requested");
  assert.deepEqual(f.notifications.markAllRead(ADMIN, { through: viewed.latestSequence }), { ok: true });
  let feed = f.notifications.list(ADMIN);
  assert.equal(feed.unreadCount, 1);
  assert.equal(feed.notifications.find((event) => event.id === arriving.id).readAt, null);
  assert.equal(f.notifications.list(STAFF).unreadCount, 2);
  f.notifications.markAllRead(ADMIN, { through: 0 });
  assert.equal(f.notifications.list(ADMIN).unreadCount, 1);
  f.notifications.markAllRead(ADMIN, { through: Number.MAX_SAFE_INTEGER });
  const afterRead = f.publish(member, "member_profile_updated");
  feed = f.notifications.list(ADMIN);
  assert.equal(feed.unreadCount, 1);
  assert.equal(feed.notifications[0].id, afterRead.id);
});

test("member deletion removes every linked notification and receipt without affecting another member's activity", (t) => {
  const f = fixture(t);
  const erased = f.add({ name: "Erase This Name" });
  const retained = f.add({ name: "Keep This Name" });
  const event = f.publish(erased);
  const other = f.publish(retained);
  f.notifications.markRead(ADMIN, event.id);
  f.notifications.markRead(STAFF, event.id);
  f.notifications.markRead(ADMIN, other.id);
  f.db.prepare("DELETE FROM members WHERE id=?").run(erased.id);
  const feed = f.notifications.list(ADMIN);
  assert.equal(feed.notifications.length, 1);
  assert.equal(feed.notifications[0].id, other.id);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notification_reads WHERE notification_id=?").get(event.id).total, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notification_reads").get().total, 1);
  assert.equal(JSON.stringify(feed).includes(erased.id), false);
  assert.equal(JSON.stringify(feed).includes(erased.name), false);
  assert.throws(() => f.notifications.markRead(ADMIN, event.id), errorStatus(404));
});

test("notifications and separate read receipts survive a database restart without replaying historical registrations", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-notification-restart-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "notifications.sqlite");
  let db = database(filename);
  let notifications = createStaffNotifications({ db, HttpError });
  const member = { id: randomUUID(), name: "Restart Member", email: "restart@example.test" };
  db.prepare("INSERT INTO members(id,name,email) VALUES (?,?,?)").run(member.id, member.name, member.email);
  const event = notifications.publish({ type: "member_registered", memberId: member.id, sourceRef: member.id });
  notifications.markRead(ADMIN, event.id);
  notifications.close(); db.close();
  db = database(filename);
  notifications = createStaffNotifications({ db, HttpError });
  t.after(() => { notifications.close(); db.close(); });
  assert.equal(notifications.list(ADMIN).unreadCount, 0);
  assert.equal(notifications.list(STAFF).unreadCount, 1);
  assert.equal(notifications.list(ADMIN).notifications[0].id, event.id);
  assert.deepEqual(notifications.publish({ type: "member_registered", memberId: member.id, sourceRef: member.id }), event);
  assert.equal(notifications.list(STAFF).total, 1);
});

test("retention purges expired events and receipts and caps a high-volume feed at the newest ten thousand", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let clock = Date.now();
  const f = fixture(t, { now: () => clock });
  const member = f.add();
  const expired = f.publish(member);
  f.notifications.markRead(ADMIN, expired.id);
  clock += 30 * DAY + 1;
  f.db.exec("BEGIN IMMEDIATE");
  t.mock.timers.tick(60 * 60 * 1000);
  assert.equal(f.db.isTransaction, true, "Maintenance must not commit the caller's transaction.");
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notifications").get().total, 1);
  f.db.exec("COMMIT");
  f.db.exec("CREATE TRIGGER fail_notification_maintenance BEFORE DELETE ON staff_notifications BEGIN SELECT RAISE(ABORT,'local maintenance failure'); END;");
  assert.doesNotThrow(() => t.mock.timers.tick(60 * 60 * 1000));
  assert.equal(f.db.isTransaction, false);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notifications").get().total, 1);
  f.db.exec("DROP TRIGGER fail_notification_maintenance");
  t.mock.timers.tick(60 * 60 * 1000);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notifications").get().total, 0, "A quiet service must expire old events without another request.");
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notification_reads").get().total, 0);
  const current = f.publish(member, "member_profile_updated");
  assert.equal(f.notifications.list(ADMIN).total, 1);
  assert.equal(f.notifications.list(ADMIN).notifications[0].id, current.id);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notification_reads").get().total, 0);
  const insert = f.db.prepare("INSERT INTO staff_notifications(id,type,member_id,source_hash,created_at) VALUES (?,?,?,?,?)");
  f.db.exec("BEGIN IMMEDIATE");
  for (let index = 0; index < 10001; index++) {
    const id = randomUUID();
    insert.run(id, "member_profile_updated", member.id, createHash("sha256").update(id).digest("hex"), new Date(clock).toISOString());
  }
  f.db.exec("COMMIT");
  const feed = f.notifications.list(ADMIN, { limit: 50 });
  assert.equal(feed.total, 10000);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notifications").get().total, 10000);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notifications WHERE id=?").get(current.id).total, 0);
  clock += 30 * DAY + 1;
  f.notifications.close();
  const restarted = createStaffNotifications({ db: f.db, HttpError, now: () => clock });
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notifications").get().total, 0, "Startup must purge events that expired during downtime before the first feed request.");
  restarted.close();
});

test("invalid or cross-member event references and malformed feed mutations cannot alter another account's feed", (t) => {
  const f = fixture(t);
  const member = f.add(), other = f.add();
  const sourceRef = randomUUID();
  const event = f.publish(member, "member_registered", sourceRef);
  assert.throws(() => f.publish(other, "member_registered", sourceRef), errorStatus(409));
  assert.throws(() => f.notifications.publish({ type: "member_registered", memberId: randomUUID(), sourceRef: randomUUID() }), errorStatus(404));
  for (const change of [{ type: "order_received" }, { sourceRef: "" }, { sourceRef: "x".repeat(513) }, { memberId: null }])
    assert.throws(() => f.notifications.publish({ type: "member_registered", memberId: member.id, sourceRef: randomUUID(), ...change }), errorStatus(422));
  for (const options of [{ limit: 0 }, { limit: 51 }, { limit: "1e1" }, { before: -1 }, { before: "1 OR 1=1" }, { before: "1.5" }, { unreadOnly: "true" }])
    assert.throws(() => f.notifications.list(ADMIN, options), errorStatus(422));
  for (const body of [{}, { through: -1 }, { through: 1.5 }, { through: Number.MAX_SAFE_INTEGER + 1 }])
    assert.throws(() => f.notifications.markAllRead(ADMIN, body), errorStatus(422));
  assert.throws(() => f.notifications.list("member:visitor"), errorStatus(403));
  assert.throws(() => f.notifications.list("staff:person' OR 1=1"), errorStatus(403));
  assert.throws(() => f.notifications.markRead(ADMIN, "../other"), errorStatus(422));
  assert.throws(() => f.notifications.markRead(ADMIN, randomUUID()), errorStatus(404));
  assert.equal(f.notifications.list(ADMIN).unreadCount, 1);
  assert.equal(f.notifications.list(ADMIN).notifications[0].id, event.id);
});

test("failed receipt persistence rolls back bulk marking and a closed service cannot query a disposed database", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const member = f.add();
  f.publish(member);
  const latest = f.publish(member, "verification_requested");
  f.db.exec(`CREATE TRIGGER reject_bulk_receipts BEFORE INSERT ON staff_notification_reads
    WHEN (SELECT count(*) FROM staff_notification_reads)>=1
    BEGIN SELECT RAISE(ABORT,'local receipt persistence failure'); END;`);
  assert.throws(() => f.notifications.markAllRead(ADMIN, { through: latest.sequence }), /local receipt persistence failure/);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM staff_notification_reads").get().total, 0);
  assert.equal(f.notifications.list(ADMIN).unreadCount, 2);
  f.notifications.close();
  assert.throws(() => f.notifications.list(ADMIN), errorStatus(503));
  assert.throws(() => f.publish(member), errorStatus(503));
  const prepare = t.mock.method(f.db, "prepare");
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  assert.equal(prepare.mock.callCount(), 0, "Closing the service must cancel database maintenance.");
});
