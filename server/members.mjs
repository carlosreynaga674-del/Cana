import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_NAME = "lc_member";
const PASSWORD_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const clean = (value) => (typeof value === "string" ? value.trim() : "");
const emailAddress = (value) => clean(value).toLowerCase();

/** Persistent, cookie-authenticated accounts, separate from staff access and sales activation. */
export function createMemberHandlers({
  db,
  production,
  send,
  readJson,
  rateLimit,
  HttpError,
  productIds,
}) {
  const knownProducts = new Set(productIds);
  let activeDerivations = 0;
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      favorites_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      age_confirmed_at TEXT NOT NULL,
      terms_accepted_at TEXT NOT NULL,
      terms_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_sessions (
      token_hash TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS member_sessions_member ON member_sessions(member_id);
    CREATE INDEX IF NOT EXISTS member_sessions_expiry ON member_sessions(expires_at);
  `);
  const byId = db.prepare("SELECT * FROM members WHERE id = ?");
  const byEmail = db.prepare("SELECT * FROM members WHERE email = ?");
  const sessionByHash = db.prepare(
    "SELECT member_id, expires_at FROM member_sessions WHERE token_hash = ?",
  );
  const revokeSession = db.prepare(
    "DELETE FROM member_sessions WHERE token_hash = ?",
  );
  const revokeAll = db.prepare(
    "DELETE FROM member_sessions WHERE member_id = ?",
  );

  function cookie(value, seconds = SESSION_SECONDS) {
    return `${COOKIE_NAME}=${value}; Path=/api/members; HttpOnly; SameSite=Strict; Max-Age=${seconds}${production ? "; Secure" : ""}`;
  }
  function incomingToken(req) {
    const raw =
      String(req.headers.cookie || "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE_NAME}=`))
        ?.slice(COOKIE_NAME.length + 1) || "";
    return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : "";
  }
  function publicMember(row) {
    let favorites = [];
    try {
      favorites = JSON.parse(row.favorites_json);
    } catch {
      /* Recover a damaged preference without exposing storage. */
    }
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.created_at,
      favorites: Array.isArray(favorites)
        ? [...new Set(favorites.filter((id) => knownProducts.has(id)))]
        : [],
    };
  }
  function sessionMember(req) {
    const token = incomingToken(req);
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = sessionByHash.get(tokenHash);
    if (!session || session.expires_at <= Date.now()) {
      if (session) revokeSession.run(tokenHash);
      return null;
    }
    const member = byId.get(session.member_id);
    return member ? { member, tokenHash } : null;
  }
  function authenticate(req) {
    const session = sessionMember(req);
    if (!session)
      throw new HttpError(401, "Please sign in to your membership account.");
    return session;
  }
  function issueSession(res, memberId) {
    db.prepare("DELETE FROM member_sessions WHERE expires_at <= ?").run(
      Date.now(),
    );
    const token = randomBytes(32).toString("base64url");
    db.prepare(
      "INSERT INTO member_sessions (token_hash,member_id,created_at,expires_at) VALUES (?,?,?,?)",
    ).run(
      hashToken(token),
      memberId,
      new Date().toISOString(),
      Date.now() + SESSION_SECONDS * 1000,
    );
    db.prepare(
      `DELETE FROM member_sessions WHERE member_id = ? AND token_hash NOT IN
      (SELECT token_hash FROM member_sessions WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 5)`,
    ).run(memberId, memberId);
    res.setHeader("Set-Cookie", cookie(token));
  }
  async function passwordKey(password, salt) {
    // Bound work in flight instead of accumulating an unbounded crypto queue.
    if (activeDerivations >= 8)
      throw new HttpError(503, "Sign-in is busy. Please try again shortly.");
    activeDerivations += 1;
    try {
      return await deriveKey(password, salt, 64, PASSWORD_OPTIONS);
    } finally {
      activeDerivations -= 1;
    }
  }
  async function passwordMatches(password, member) {
    const candidate =
      typeof password === "string" && password.length <= 128 ? password : "";
    const salt = member?.password_salt || "00000000000000000000000000000000";
    const expected = member
      ? Buffer.from(member.password_hash, "hex")
      : Buffer.alloc(64);
    const actual = await passwordKey(candidate, salt);
    return (
      expected.length === actual.length &&
      timingSafeEqual(actual, expected) &&
      Boolean(member)
    );
  }
  function validPassword(value) {
    return (
      typeof value === "string" && value.length >= 12 && value.length <= 128
    );
  }
  function fieldsError(errors) {
    throw new HttpError(422, "Please check the highlighted details.", errors);
  }
  async function bodyObject(req) {
    const body = await readJson(req);
    if (!record(body))
      throw new HttpError(400, "Please submit a valid account request.");
    return body;
  }

  return async function handleMembers(req, res, pathname) {
    if (!pathname.startsWith("/api/members/")) return false;
    if (pathname === "/api/members/me" && req.method === "GET") {
      const session = sessionMember(req);
      if (!session && incomingToken(req))
        res.setHeader("Set-Cookie", cookie("", 0));
      send(res, 200, { member: session ? publicMember(session.member) : null });
      return true;
    }
    if (pathname === "/api/members/signup" && req.method === "POST") {
      rateLimit(req, "member-signup", 120, 60 * 60 * 1000);
      const body = await bodyObject(req);
      const name = clean(body.name);
      const email = emailAddress(body.email);
      const errors = {};
      if (name.length < 2 || name.length > 80)
        errors.name = "Enter a name between 2 and 80 characters.";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.email = "Enter a valid email address.";
      if (!validPassword(body.password))
        errors.password = "Use a password between 12 and 128 characters.";
      if (
        body.confirmPassword !== undefined &&
        body.confirmPassword !== body.password
      )
        errors.confirmPassword = "The passwords do not match.";
      if (body.ageConfirmed !== true)
        errors.ageConfirmed = "Confirm that you are 21 or older.";
      if (body.termsAccepted !== true)
        errors.termsAccepted =
          "Accept the membership terms and privacy policy.";
      if (Object.keys(errors).length) fieldsError(errors);
      rateLimit(
        req,
        `member-signup-email:${hashToken(email)}`,
        5,
        60 * 60 * 1000,
      );
      const salt = randomBytes(16).toString("hex");
      const passwordHash = (await passwordKey(body.password, salt)).toString(
        "hex",
      );
      const id = randomUUID();
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO members (id,email,name,password_salt,password_hash,created_at,updated_at,age_confirmed_at,terms_accepted_at,terms_version)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          email,
          name,
          salt,
          passwordHash,
          now,
          now,
          now,
          now,
          "2026-10-22",
        );
        issueSession(res, id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        if (byEmail.get(email))
          throw new HttpError(
            409,
            "An account already uses this email. Please sign in instead.",
          );
        throw error;
      }
      send(res, 201, { member: publicMember(byId.get(id)) });
      return true;
    }
    if (pathname === "/api/members/login" && req.method === "POST") {
      rateLimit(req, "member-login", 240, 15 * 60 * 1000);
      const body = await bodyObject(req);
      const suppliedEmail = emailAddress(body.email);
      const email = suppliedEmail.length <= 254 ? suppliedEmail : "";
      rateLimit(
        req,
        `member-login-email:${hashToken(email)}`,
        12,
        15 * 60 * 1000,
      );
      const member = byEmail.get(email);
      const matches = await passwordMatches(body.password, member);
      const current = member && byId.get(member.id);
      if (
        !matches ||
        !current ||
        current.password_hash !== member.password_hash
      )
        throw new HttpError(401, "The email or password was not accepted.");
      issueSession(res, member.id);
      send(res, 200, { member: publicMember(current) });
      return true;
    }
    if (pathname === "/api/members/logout" && req.method === "POST") {
      const token = incomingToken(req);
      if (token) revokeSession.run(hashToken(token));
      res.setHeader("Set-Cookie", cookie("", 0));
      send(res, 200, { ok: true });
      return true;
    }
    if (pathname === "/api/members/me" && req.method === "PATCH") {
      const { member } = authenticate(req);
      rateLimit(req, `member-profile:${member.id}`, 90, 15 * 60 * 1000);
      const body = await bodyObject(req);
      const errors = {};
      const name = body.name === undefined ? member.name : clean(body.name);
      if (name.length < 2 || name.length > 80)
        errors.name = "Enter a name between 2 and 80 characters.";
      let favorites;
      if (body.favorites !== undefined) {
        if (
          !Array.isArray(body.favorites) ||
          body.favorites.length > 100 ||
          body.favorites.some(
            (id) => typeof id !== "string" || !knownProducts.has(id),
          )
        )
          errors.favorites =
            "Choose saved products from the current collection.";
        else favorites = [...new Set(body.favorites)];
      }
      if (Object.keys(errors).length) fieldsError(errors);
      if (body.name === undefined && body.favorites === undefined)
        fieldsError({ profile: "Choose a profile detail to update." });
      const current = byId.get(member.id);
      if (!current)
        throw new HttpError(401, "Please sign in to your membership account.");
      db.prepare(
        "UPDATE members SET name = ?, favorites_json = ?, updated_at = ? WHERE id = ?",
      ).run(
        body.name === undefined ? current.name : name,
        favorites === undefined
          ? current.favorites_json
          : JSON.stringify(favorites),
        new Date().toISOString(),
        member.id,
      );
      send(res, 200, { member: publicMember(byId.get(member.id)) });
      return true;
    }
    if (pathname === "/api/members/password" && req.method === "POST") {
      const { member } = authenticate(req);
      rateLimit(req, `member-security:${member.id}`, 12, 15 * 60 * 1000);
      const body = await bodyObject(req);
      if (!validPassword(body.newPassword))
        fieldsError({
          newPassword: "Use a password between 12 and 128 characters.",
        });
      if (!(await passwordMatches(body.currentPassword, member)))
        throw new HttpError(401, "The current password was not accepted.");
      const salt = randomBytes(16).toString("hex");
      const passwordHash = (await passwordKey(body.newPassword, salt)).toString(
        "hex",
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = db
          .prepare(
            "UPDATE members SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ? AND password_hash = ?",
          )
          .run(
            salt,
            passwordHash,
            new Date().toISOString(),
            member.id,
            member.password_hash,
          );
        if (result.changes !== 1)
          throw new HttpError(
            401,
            "Your security settings changed. Please sign in again.",
          );
        revokeAll.run(member.id);
        issueSession(res, member.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      send(res, 200, { member: publicMember(byId.get(member.id)) });
      return true;
    }
    if (pathname === "/api/members/me" && req.method === "DELETE") {
      const { member } = authenticate(req);
      rateLimit(req, `member-security:${member.id}`, 12, 15 * 60 * 1000);
      const body = await bodyObject(req);
      if (!(await passwordMatches(body.password, member)))
        throw new HttpError(401, "The password was not accepted.");
      const result = db
        .prepare("DELETE FROM members WHERE id = ? AND password_hash = ?")
        .run(member.id, member.password_hash);
      if (result.changes !== 1)
        throw new HttpError(
          401,
          "Your security settings changed. Please sign in again.",
        );
      res.setHeader("Set-Cookie", cookie("", 0));
      send(res, 200, { ok: true });
      return true;
    }
    const knownPaths = new Set([
      "/api/members/signup",
      "/api/members/login",
      "/api/members/logout",
      "/api/members/me",
      "/api/members/password",
    ]);
    throw new HttpError(
      knownPaths.has(pathname) ? 405 : 404,
      knownPaths.has(pathname)
        ? "Method not allowed."
        : "Membership endpoint not found.",
    );
  };
}
