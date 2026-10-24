import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { createOnboarding, ONBOARDING_POLICY_VERSION } from "./onboarding.mjs";
import { createIdentityService } from "./identity.mjs";

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
  readIdentityJson = readJson,
  rateLimit,
  HttpError,
  productIds,
  identityConfig = {},
  onMemberAuthenticated = () => {},
}) {
  const knownProducts = () => new Set(typeof productIds === "function" ? productIds() : productIds);
  let activeDerivations = 0;
  let activeIdentityRequests = 0;
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
  const onboarding = createOnboarding({ db, production, HttpError });
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
  const identity = createIdentityService({
    db, HttpError, config: { ...identityConfig, production },
    getApplication(memberId) {
      const member = byId.get(memberId);
      const application = onboarding.providerApplication(memberId);
      return member && application ? { ...application, name: member.name } : null;
    },
    recordDecision: (decision) => onboarding.recordIdentityDecision(decision),
  });

  function cookie(value, seconds = SESSION_SECONDS) {
    return `${COOKIE_NAME}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${seconds}${production ? "; Secure" : ""}`;
  }
  function setMemberCookie(res, value, seconds = SESSION_SECONDS) {
    const existing = res.getHeader("Set-Cookie");
    const cookies = Array.isArray(existing)
      ? existing
      : existing
        ? [existing]
        : [];
    // Remove the older narrow-path cookie so it cannot shadow the new order-capable session.
    res.setHeader("Set-Cookie", [
      cookie(value, seconds),
      `lc_member=; Path=/api/members; HttpOnly; SameSite=Strict; Max-Age=0${production ? "; Secure" : ""}`,
      ...cookies,
    ]);
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
    // Upload expiry can update the age decision; expose both states from the
    // same completed cleanup rather than returning a stale age status once.
    const identityVerification = identity.status(row.id);
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
      ageVerification: onboarding.publicAge(row.id),
      identityVerification,
      favorites: Array.isArray(favorites)
        ? [...new Set(favorites.filter((id) => knownProducts().has(id)))]
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
    return member ? { member, tokenHash, expiresAt: session.expires_at } : null;
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
    setMemberCookie(res, token);
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
  async function signIn(req, res, body, unified = false) {
    rateLimit(req, "member-login", 240, 15 * 60 * 1000);
    if (!record(body)) throw new HttpError(400, "Please submit a valid sign-in request.");
    const suppliedEmail = emailAddress(body.email);
    const email = suppliedEmail.length <= 254 ? suppliedEmail : "";
    rateLimit(req, `member-login-email:${hashToken(email)}`, 12, 15 * 60 * 1000);
    const member = byEmail.get(email);
    const matches = await passwordMatches(body.password, member);
    const current = member && byId.get(member.id);
    if (!matches || !current || current.password_hash !== member.password_hash)
      throw new HttpError(401, "The email, username or password was not accepted.");
    issueSession(res, member.id);
    onMemberAuthenticated(req, res);
    send(res, 200, { ...(unified ? { role: "member" } : {}), member: publicMember(current) });
  }

  const handleMembers = async function handleMembers(req, res, pathname) {
    if (!pathname.startsWith("/api/members/")) return false;
    if (pathname === "/api/members/me" && req.method === "GET") {
      const session = sessionMember(req);
      if (session)
        setMemberCookie(
          res,
          incomingToken(req),
          Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000)),
        );
      else if (incomingToken(req)) setMemberCookie(res, "", 0);
      send(res, 200, { member: session ? publicMember(session.member) : null });
      return true;
    }
    if (pathname === "/api/members/signup-challenge" && req.method === "GET") {
      rateLimit(req, "member-signup-challenge", 240, 60 * 60 * 1000);
      send(res, 200, onboarding.createChallenge(req, res));
      return true;
    }
    if (pathname === "/api/members/identity-verification" && req.method === "GET") {
      const { member } = authenticate(req);
      send(res, 200, { verification: identity.status(member.id) });
      return true;
    }
    if (pathname === "/api/members/identity-verification" && req.method === "POST") {
      const { member } = authenticate(req);
      rateLimit(req, `member-identity:${member.id}`, 12, 60 * 60 * 1000);
      if (activeIdentityRequests >= 2)
        throw new HttpError(503, "Image uploads are busy. Please try again shortly.");
      activeIdentityRequests += 1;
      try {
        const body = await readIdentityJson(req);
        if (!record(body)) throw new HttpError(400, "Submit the ID and selfie as a valid request.");
        if (body.identityConsent !== true)
          fieldsError({ identityConsent: "Consent to private ID and selfie processing for staff review before continuing." });
        authenticate(req);
        const result = await identity.submit(member.id, body, { assertAuthorized: () => authenticate(req) });
        authenticate(req);
        send(res, 200, result);
      } finally { activeIdentityRequests -= 1; }
      return true;
    }
    if (pathname === "/api/members/age-verification" && req.method === "POST") {
      const { member } = authenticate(req);
      rateLimit(req, `member-age-submission:${member.id}`, 12, 60 * 60 * 1000);
      if (onboarding.publicAge(member.id).status === "verified")
        throw new HttpError(409, "Your age check is already verified.");
      const body = await bodyObject(req);
      authenticate(req);
      const submission = onboarding.validateSubmission(req, body);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!byId.get(member.id))
          throw new HttpError(401, "Please sign in again.");
        onboarding.recordSubmission(member.id, submission, res);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      send(res, 200, { member: publicMember(byId.get(member.id)) });
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
        errors.ageConfirmed = "Confirm that you are 18 or older.";
      if (body.termsAccepted !== true)
        errors.termsAccepted =
          "Accept the membership terms and privacy policy.";
      if (body.identityConsent !== true)
        errors.identityConsent = "Consent to the stated secure document and face verification.";
      if (Object.keys(errors).length) fieldsError(errors);
      const submission = onboarding.validateSubmission(req, body);
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
          ONBOARDING_POLICY_VERSION,
        );
        onboarding.recordSubmission(id, submission, res, true);
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
      onMemberAuthenticated(req, res);
      send(res, 201, { member: publicMember(byId.get(id)) });
      return true;
    }
    if (pathname === "/api/members/login" && req.method === "POST") {
      const body = await bodyObject(req);
      await signIn(req, res, body);
      return true;
    }
    if (pathname === "/api/members/logout" && req.method === "POST") {
      const token = incomingToken(req);
      if (token) revokeSession.run(hashToken(token));
      setMemberCookie(res, "", 0);
      send(res, 200, { ok: true });
      return true;
    }
    if (pathname === "/api/members/me" && req.method === "PATCH") {
      const { member } = authenticate(req);
      rateLimit(req, `member-profile:${member.id}`, 90, 15 * 60 * 1000);
      const body = await bodyObject(req);
      authenticate(req);
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
            (id) => typeof id !== "string" || !knownProducts().has(id),
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
      if (body.name !== undefined && name !== current.name)
        onboarding.invalidateName(member.id);
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
      setMemberCookie(res, "", 0);
      send(res, 200, { ok: true });
      return true;
    }
    const knownPaths = new Set([
      "/api/members/signup",
      "/api/members/login",
      "/api/members/logout",
      "/api/members/me",
      "/api/members/password",
      "/api/members/signup-challenge",
      "/api/members/age-verification",
      "/api/members/identity-verification",
    ]);
    throw new HttpError(
      knownPaths.has(pathname) ? 405 : 404,
      knownPaths.has(pathname)
        ? "Method not allowed."
        : "Membership endpoint not found.",
    );
  };
  handleMembers.requireVerifiedMember = (req) => {
    const { member } = authenticate(req);
    onboarding.requireVerified(member.id);
    return publicMember(member);
  };
  handleMembers.signIn = (req, res, body) => signIn(req, res, body, true);
  handleMembers.clearSession = (req, res) => {
    const token = incomingToken(req);
    if (token) revokeSession.run(hashToken(token));
    setMemberCookie(res, "", 0);
  };
  handleMembers.ageQueue = (status) => {
    identity.cleanup();
    return onboarding.queue(status).map((member) => ({ ...member, identityVerification: identity.status(member.id) }));
  };
  handleMembers.listMembers = ({ q = "", page = "1", limit = "20" } = {}) => {
    const pageNumber = Number(page), pageSize = Number(limit);
    if (typeof q !== "string" || q.length > 120 || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw new HttpError(422, "Choose a valid member search and page.");
    const query = q.trim().toLowerCase();
    const where = "WHERE instr(lower(name),?)>0 OR instr(lower(email),?)>0";
    const total = db.prepare(`SELECT COUNT(*) AS count FROM members ${where}`).get(query, query).count;
    const rows = db.prepare(`SELECT * FROM members ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(query, query, pageSize, (pageNumber - 1) * pageSize);
    return { members: rows.map((row) => {
      const member = publicMember(row);
      return { id: member.id, name: member.name, email: member.email, createdAt: member.createdAt, ageVerification: member.ageVerification, identityVerification: member.identityVerification };
    }), total, page: pageNumber, limit: pageSize };
  };
  handleMembers.identityImage = (id, kind, uploadId) => identity.image(id, kind, uploadId);
  handleMembers.identityConfiguration = () => identity.configStatus();
  handleMembers.reviewAge = (id, body, reviewerRef) => {
    if (onboarding.providerApplication(id)?.identityRequired) {
      if (body.method !== "uploaded_id_selfie")
        throw new HttpError(409, "This member requires the uploaded ID and selfie review.");
      identity.review(id, body, reviewerRef);
    } else onboarding.review(id, body, reviewerRef);
    return publicMember(byId.get(id));
  };
  handleMembers.close = () => { identity.dispose(); onboarding.close(); };
  return handleMembers;
}
