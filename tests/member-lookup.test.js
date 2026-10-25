import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "../server/app.mjs";
import { prepareSignup, cookieValue } from "./helpers/age-fixture.mjs";
import { identityFixture } from "./helpers/identity-fixture.mjs";

// Local membership lookup only: sales gates are unset and mail is unconfigured.
const ADMIN = "Local member lookup administrator password 42";
const STAFF = "Local member lookup staff password 84";
const MEMBER = "Local member lookup applicant password 96";
const EMPLOYEE = "Local member lookup employee password 28";
const LOOKUP = "/api/admin/members/lookup";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "cana-member-lookup-"));
  const dbPath = join(directory, "lookup.sqlite");
  const images = await identityFixture();
  let server, base;
  async function start() {
    server = createServer({
      dbPath,
      adminPassword: ADMIN,
      staffPassword: STAFF,
      config: { businessName: "Local member lookup fixture" },
      identityConfig: images.config,
      mailConfig: {},
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = "http://127.0.0.1:" + server.address().port;
  }
  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, { body, cookie, headers, ...options } = {}) => fetch(base + path, {
    ...options,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function login(identifier, password) {
    const response = await request("/api/auth/login", { method: "POST", body: { identifier, password } });
    assert.equal(response.status, 200, await response.clone().text());
    return cookieValue(response, identifier.includes("@") ? "lc_member" : "lc_staff");
  }
  const adminCookie = await login("admin", ADMIN);
  const staffCookie = await login("staff", STAFF);
  async function signup() {
    const prepared = await prepareSignup(request, {
      name: "Local lookup applicant", email: randomUUID() + "@example.test", password: MEMBER,
      ageConfirmed: true, termsAccepted: true, identityConsent: true,
    });
    const response = await request("/api/members/signup", { method: "POST", ...prepared });
    assert.equal(response.status, 201, await response.clone().text());
    return { member: (await response.json()).member, cookie: cookieValue(response, "lc_member") };
  }
  async function lookup(number, cookie = adminCookie) {
    const response = await request(LOOKUP, { method: "POST", cookie, body: { membershipNumber: number } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get("cache-control"), /no-store/);
    return (await response.json()).member;
  }
  return {
    request, login, signup, lookup, images, dbPath, adminCookie, staffCookie,
    get base() { return base; }, get server() { return server; },
    restart: async () => { await stop(); await start(); },
  };
}

function assertPrivateProfile(result, applicant) {
  assert.deepEqual(Object.keys(result).sort(), [
    "ageVerification", "createdAt", "id", "identityVerification", "membershipNumber", "name", "verified",
  ]);
  assert.deepEqual(Object.keys(result.ageVerification), ["status"]);
  assert.deepEqual(Object.keys(result.identityVerification).sort(), ["required", "status"]);
  assert.equal(result.id, applicant.member.id);
  assert.equal(result.membershipNumber, applicant.member.membershipNumber);
  const payload = JSON.stringify(result);
  for (const forbidden of [applicant.member.email, MEMBER, "2000-01-01", "document_blob", "password_hash"])
    assert.equal(payload.includes(forbidden), false, "Lookup must not disclose identity evidence or credentials.");
}

test("membership barcode lookup requires workforce authentication, returns minimal data and rejects cross-site requests", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  for (const cookie of [undefined, applicant.cookie]) {
    const response = await f.request(LOOKUP, {
      method: "POST", cookie, body: { membershipNumber: applicant.member.membershipNumber },
    });
    assert.equal(response.status, 401);
    assert.equal(JSON.stringify(await response.json()).includes(applicant.member.name), false);
  }
  const admin = await f.lookup(applicant.member.membershipNumber);
  const worker = await f.lookup(applicant.member.membershipNumber, f.staffCookie);
  assertPrivateProfile(admin, applicant);
  assert.deepEqual(worker, admin);
  assert.equal(admin.verified, false);
  assert.equal(admin.ageVerification.status, "pending");
  const crossSite = await f.request(LOOKUP, {
    method: "POST", cookie: f.adminCookie, body: { membershipNumber: applicant.member.membershipNumber },
    headers: { Origin: "https://unrelated.example.test" },
  });
  assert.equal(crossSite.status, 403);
  // The login document remains active during SPA navigation to a staff route.
  for (const path of ["/login", "/admin", "/staff"]) {
    const response = await f.request(path);
    assert.match(response.headers.get("permissions-policy"), /camera=\(self\)/);
    assert.match(response.headers.get("permissions-policy"), /microphone=\(\)/);
    assert.match(response.headers.get("permissions-policy"), /geolocation=\(\)/);
  }
});

test("lookup normalizes a membership number but rejects arbitrary barcode payloads and unknown accounts", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  const number = applicant.member.membershipNumber;
  assert.equal((await f.lookup("  " + number.toLowerCase() + "\r\n")).id, applicant.member.id);
  for (const body of [
    null, [], "not-an-object", {}, { membershipNumber: null }, { membershipNumber: 12345 },
    { membershipNumber: "" }, { membershipNumber: "LC-12345" }, { membershipNumber: "LC-1234567" },
    { membershipNumber: "LC-12345A" }, { membershipNumber: "LC-AAAA-BBBB-IIII" },
    { membershipNumber: "https://unrelated.example.test/" + number },
    { membershipNumber: "<script>alert(1)</script>" },
    { membershipNumber: JSON.stringify({ membershipNumber: number }) },
    { membershipNumber: number + "' OR 1=1" },
    { membershipNumber: number, role: "admin" },
    { membershipNumber: number, memberId: applicant.member.id },
  ]) {
    const response = await f.request(LOOKUP, { method: "POST", cookie: f.adminCookie, body });
    assert.equal(response.status, 422, JSON.stringify(body) + ": " + await response.text());
  }
  const missing = number === "LC-000000" ? "LC-000001" : "LC-000000";
  assert.equal((await f.request(LOOKUP, {
    method: "POST", cookie: f.staffCookie, body: { membershipNumber: missing },
  })).status, 404);
  assert.equal((await f.request(LOOKUP, {
    method: "POST", cookie: f.staffCookie, body: { membershipNumber: "LC-AAAA-BBBB-CCCC" },
  })).status, 404, "A well-formed legacy reference is accepted for lookup but must match a retained alias.");
});

test("every scan checks current verification without creating activity records or exposing documents", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  const uploaded = await f.request("/api/members/identity-verification", {
    method: "POST", cookie: applicant.cookie, body: f.images.body,
  });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const verification = (await uploaded.json()).verification;
  const database = new DatabaseSync(f.dbPath);
  const before = database.prepare("SELECT COUNT(*) AS count FROM staff_notifications").get().count;
  try {
    const pending = await f.lookup(applicant.member.membershipNumber);
    assertPrivateProfile(pending, applicant);
    assert.equal(pending.identityVerification.status, "pending");
    assert.equal(pending.verified, false);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM staff_notifications").get().count, before);
    const reviewed = await f.request("/api/admin/members/" + applicant.member.id + "/age-verification", {
      method: "POST", cookie: f.staffCookie,
      body: {
        method: "uploaded_id_selfie", decision: "verified", identityChecked: true, ageChecked: true,
        expectedUploadId: verification.uploadId, expectedSubmittedAt: verification.submittedAt,
      },
    });
    assert.equal(reviewed.status, 200, await reviewed.clone().text());
    const approved = await f.lookup(applicant.member.membershipNumber, f.staffCookie);
    assertPrivateProfile(approved, applicant);
    assert.equal(approved.verified, true);
    assert.equal(approved.ageVerification.status, "verified");
    assert.equal(approved.identityVerification.status, "verified");
    const changed = await f.request("/api/members/me", {
      method: "PATCH", cookie: applicant.cookie, body: { name: "Local renamed lookup applicant" },
    });
    assert.equal(changed.status, 200, await changed.clone().text());
    const renamed = await f.lookup(applicant.member.membershipNumber);
    assert.equal(renamed.name, "Local renamed lookup applicant");
    assert.equal(renamed.ageVerification.status, "required");
    assert.equal(renamed.verified, false);
    const finalCount = database.prepare("SELECT COUNT(*) AS count FROM staff_notifications").get().count;
    for (const cookie of [f.adminCookie, f.staffCookie]) await f.lookup(applicant.member.membershipNumber, cookie);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM staff_notifications").get().count, finalCount);
  } finally { database.close(); }
});

test("membership lookup survives restart while deleted membership numbers stop resolving", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  const original = await f.lookup(applicant.member.membershipNumber);
  // Synthetic retained alias, matching the migration's private reference map.
  const legacy = "LC-0123-ABCD-WXYZ";
  const database = new DatabaseSync(f.dbPath);
  try {
    database.prepare("INSERT INTO member_number_aliases (number,member_id) VALUES (?,?)")
      .run(legacy, applicant.member.id);
  } finally { database.close(); }
  assert.deepEqual(await f.lookup(legacy.toLowerCase(), f.staffCookie), original,
    "A saved legacy barcode resolves to the current canonical member profile.");
  await f.restart();
  const cookie = await f.login("admin", ADMIN);
  assert.deepEqual(await f.lookup(applicant.member.membershipNumber, cookie), original);
  assert.deepEqual(await f.lookup(legacy, cookie), original);
  const deleted = await f.request("/api/members/me", {
    method: "DELETE", cookie: applicant.cookie, body: { password: MEMBER },
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  const response = await f.request(LOOKUP, {
    method: "POST", cookie, body: { membershipNumber: applicant.member.membershipNumber },
  });
  assert.equal(response.status, 404);
  assert.equal((await f.request(LOOKUP, {
    method: "POST", cookie, body: { membershipNumber: legacy },
  })).status, 404, "Deleting the account also stops saved legacy barcodes resolving.");
});

test("individual staff can look up members until their access is revoked", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  const created = await f.request("/api/admin/staff", {
    method: "POST", cookie: f.adminCookie,
    body: { name: "Local barcode reviewer", username: "lookup.employee", password: EMPLOYEE },
  });
  assert.equal(created.status, 201, await created.clone().text());
  const employee = (await created.json()).staff;
  const cookie = await f.login(employee.username, EMPLOYEE);
  assert.equal((await f.lookup(applicant.member.membershipNumber, cookie)).id, applicant.member.id);
  const disabled = await f.request("/api/admin/staff/" + employee.id, {
    method: "PATCH", cookie: f.adminCookie, body: { revision: employee.revision, active: false },
  });
  assert.equal(disabled.status, 200, await disabled.clone().text());
  assert.equal((await f.request(LOOKUP, {
    method: "POST", cookie, body: { membershipNumber: applicant.member.membershipNumber },
  })).status, 401);
  assert.equal((await f.lookup(applicant.member.membershipNumber)).id, applicant.member.id);
});

test("logout during a slow lookup body prevents a stale session from receiving member data", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  let received;
  const receiving = new Promise((resolve) => { received = resolve; });
  const incoming = (request) => { if (request.url === LOOKUP) received(); };
  f.server.on("request", incoming);
  const responsePromise = fetch(f.base + LOOKUP, {
    method: "POST", duplex: "half",
    headers: { "Content-Type": "application/json", Cookie: f.adminCookie },
    body: (async function* () {
      yield '{"membershipNumber":';
      await paused;
      yield JSON.stringify(applicant.member.membershipNumber) + "}";
    })(),
  });
  await receiving;
  try {
    const logout = await f.request("/api/admin/logout", { method: "POST", cookie: f.adminCookie, body: {} });
    assert.equal(logout.status, 200);
  } finally { release(); f.server.off("request", incoming); }
  const response = await responsePromise;
  assert.equal(response.status, 401);
  assert.equal(JSON.stringify(await response.json()).includes(applicant.member.name), false);
});
