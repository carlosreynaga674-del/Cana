import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
const PASSWORD_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const USERNAME = /^[a-z][a-z0-9._-]{2,39}$/;
const RESERVED = new Set(["admin", "staff"]);
const CONTROL = /[\u0000-\u001f\u007f]/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clean = (value) => typeof value === "string" ? value.trim() : "";
const usernameOf = (value) => clean(value).toLowerCase();
const validPassword = (value) => typeof value === "string" && value.length >= 16 && value.length <= 256;

export class WorkforceError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/** Individual staff accounts; only the host's authenticated administrator may mutate them. */
export function createWorkforce({ db, HttpError = WorkforceError, now = Date.now } = {}) {
  if (!db) throw new TypeError("A SQLite database is required.");
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL CHECK(active IN (0,1)),
      credential_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS staff_users_active ON staff_users(active,created_at DESC);
    CREATE TABLE IF NOT EXISTS workforce_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id TEXT NOT NULL REFERENCES staff_users(id),
      action TEXT NOT NULL,
      actor_ref TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const byId = db.prepare("SELECT * FROM staff_users WHERE id=?");
  const byUsername = db.prepare("SELECT * FROM staff_users WHERE username=?");
  const insert = db.prepare(`INSERT INTO staff_users
    (id,name,username,password_salt,password_hash,active,credential_version,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,1,1,1,?,?)`);
  const auditInsert = db.prepare("INSERT INTO workforce_audit (staff_id,action,actor_ref,revision,created_at) VALUES (?,?,?,?,?)");
  const dummySalt = randomBytes(16).toString("hex");
  const dummyHash = randomBytes(64);
  let activeDerivations = 0;
  const stamp = () => new Date(now()).toISOString();

  function safe(row) {
    return row ? {
      id: row.id, name: row.name, username: row.username, role: "staff",
      active: row.active === 1, revision: row.revision,
      createdAt: row.created_at, updatedAt: row.updated_at,
    } : null;
  }
  async function passwordKey(password, salt) {
    if (activeDerivations >= 2)
      throw new HttpError(503, "Team sign-in is busy. Please try again shortly.");
    activeDerivations += 1;
    try { return await deriveKey(password, salt, 64, PASSWORD_OPTIONS); }
    finally { activeDerivations -= 1; }
  }
  function atomic(operation) {
    const outer = db.isTransaction;
    if (!outer) db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      if (!outer) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (!outer) db.exec("ROLLBACK");
      throw error;
    }
  }
  function validate(body, previous = null) {
    if (!record(body)) throw new HttpError(400, "Submit valid staff account details.");
    const allowed = new Set(previous ? ["name", "username", "active", "password", "revision"] : ["name", "username", "password"]);
    const errors = {};
    for (const field of Object.keys(body)) {
      if (!allowed.has(field)) errors[field] = "This staff account field cannot be set.";
    }
    const name = body.name === undefined && previous ? previous.name : clean(body.name);
    const username = body.username === undefined && previous ? previous.username : usernameOf(body.username);
    if (name.length < 2 || name.length > 100 || CONTROL.test(name))
      errors.name = "Enter a staff name using 2 to 100 characters.";
    if (!USERNAME.test(username) || RESERVED.has(username))
      errors.username = "Use 3 to 40 letters, numbers, dots, underscores or hyphens, starting with a letter. Admin and staff are reserved.";
    if ((!previous || body.password !== undefined) && !validPassword(body.password))
      errors.password = "Use a password between 16 and 256 characters.";
    if (previous) {
      if (!Number.isSafeInteger(body.revision) || body.revision < 1)
        errors.revision = "Refresh the staff list before changing an account.";
      if (body.active !== undefined && typeof body.active !== "boolean")
        errors.active = "Choose whether this staff account is enabled.";
      if (!["name", "username", "active", "password"].some((field) => body[field] !== undefined))
        errors.account = "Choose a staff account detail to change.";
    }
    if (Object.keys(errors).length)
      throw new HttpError(422, "Please check the staff account details.", errors);
    return { name, username, active: body.active ?? (previous ? previous.active === 1 : true) };
  }
  function audit(staffId, action, actor, revision, timestamp) {
    // The staff ID remains attributable; administrator session secrets are never stored.
    const actorRef = createHash("sha256").update(typeof actor === "string" ? actor : "administrator").digest("hex");
    auditInsert.run(staffId, action, actorRef, revision, timestamp);
  }
  function requireStaff(id) {
    const row = typeof id === "string" ? byId.get(id) : null;
    if (!row) throw new HttpError(404, "Staff account not found.");
    return row;
  }
  function list({ search = "", status = "all", limit = 20, offset = 0 } = {}) {
    if (typeof search !== "string" || search.length > 120 ||
        !["all", "active", "disabled"].includes(status) ||
        !Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isInteger(offset) || offset < 0 || offset > 100_000)
      throw new HttpError(422, "Choose a valid staff search and page.");
    const query = search.trim().toLowerCase();
    const active = status === "all" ? -1 : status === "active" ? 1 : 0;
    const where = "WHERE (instr(lower(name),?)>0 OR instr(username,?)>0) AND (?=-1 OR active=?)";
    const params = [query, query, active, active];
    const total = db.prepare(`SELECT count(*) AS count FROM staff_users ${where}`).get(...params).count;
    const staff = db.prepare(`SELECT * FROM staff_users ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map(safe);
    return { staff, total, limit, offset };
  }
  async function create(body, actorRef, { assertAuthorized } = {}) {
    const values = validate(body);
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await passwordKey(body.password, salt)).toString("hex");
    return atomic(() => {
      if (assertAuthorized) assertAuthorized();
      if (db.prepare("SELECT count(*) AS count FROM staff_users").get().count >= 500)
        throw new HttpError(409, "The staff account limit has been reached.");
      if (byUsername.get(values.username))
        throw new HttpError(409, "That staff username is already in use.", { username: "Choose another username." });
      const id = randomUUID();
      const timestamp = stamp();
      insert.run(id, values.name, values.username, salt, passwordHash, timestamp, timestamp);
      audit(id, "created", actorRef, 1, timestamp);
      return safe(byId.get(id));
    });
  }
  async function update(id, body, actorRef, { assertAuthorized } = {}) {
    const previous = requireStaff(id);
    const values = validate(body, previous);
    if (body.revision !== previous.revision)
      throw new HttpError(409, "This staff account changed. Refresh before trying again.");
    let salt = previous.password_salt;
    let passwordHash = previous.password_hash;
    if (body.password !== undefined) {
      salt = randomBytes(16).toString("hex");
      passwordHash = (await passwordKey(body.password, salt)).toString("hex");
    }
    return atomic(() => {
      if (assertAuthorized) assertAuthorized();
      const current = requireStaff(id);
      if (current.revision !== body.revision)
        throw new HttpError(409, "This staff account changed. Refresh before trying again.");
      const duplicate = byUsername.get(values.username);
      if (duplicate && duplicate.id !== id)
        throw new HttpError(409, "That staff username is already in use.", { username: "Choose another username." });
      const revoke = body.password !== undefined || values.username !== current.username || Number(values.active) !== current.active;
      const timestamp = stamp();
      const changed = db.prepare(`UPDATE staff_users SET name=?,username=?,active=?,password_salt=?,password_hash=?,
        credential_version=credential_version+?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`)
        .run(values.name, values.username, values.active ? 1 : 0, salt, passwordHash, revoke ? 1 : 0, timestamp, id, body.revision);
      if (changed.changes !== 1)
        throw new HttpError(409, "This staff account changed. Refresh before trying again.");
      const action = body.password !== undefined ? "password_reset" : values.active !== (current.active === 1)
        ? values.active ? "enabled" : "disabled" : "updated";
      audit(id, action, actorRef, current.revision + 1, timestamp);
      return safe(byId.get(id));
    });
  }
  async function authenticate(identifier, password) {
    const username = usernameOf(identifier);
    if (!USERNAME.test(username) || RESERVED.has(username) ||
        typeof password !== "string" || password.length > 256)
      return null;
    const row = byUsername.get(username);
    const actual = await passwordKey(password, row?.password_salt || dummySalt);
    const expected = row ? Buffer.from(row.password_hash, "hex") : dummyHash;
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!row || !matches || row.active !== 1) return null;
    // A concurrent reset or disable during scrypt must invalidate this login.
    const current = byId.get(row.id);
    if (!current || current.active !== 1 || current.credential_version !== row.credential_version)
      return null;
    return { staff: safe(current), credentialVersion: current.credential_version };
  }
  function validateSession(id, credentialVersion) {
    const row = typeof id === "string" ? byId.get(id) : null;
    return row && row.active === 1 && Number.isSafeInteger(credentialVersion) &&
      row.credential_version === credentialVersion ? safe(row) : null;
  }
  return {
    list, create, update, authenticate, validateSession,
    countActive: () => db.prepare("SELECT count(*) AS count FROM staff_users WHERE active=1").get().count,
  };
}
