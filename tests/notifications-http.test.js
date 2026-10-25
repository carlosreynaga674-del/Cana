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

// Isolated membership fixtures only. Sales gates stay unset and no mail is sent.
const ADMIN = "Local notification administrator password 42";
const STAFF = "Local notification legacy staff password 84";
const MEMBER = "Local notification member password 96";
const EMPLOYEE = "Local notification individual staff password 28";
const FEED = "/api/admin/notifications";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "cana-notifications-http-"));
  const dbPath = join(directory, "notifications.sqlite");
  const images = await identityFixture();
  let server, base;
  async function start() {
    server = createServer({
      dbPath,
      adminPassword: ADMIN,
      staffPassword: STAFF,
      config: { businessName: "Local notifications fixture" },
      identityConfig: images.config,
      mailConfig: {},
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  await start();
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
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
  async function signup(email = `${randomUUID()}@example.test`, name = "Local notification applicant") {
    const prepared = await prepareSignup(request, {
      name, email, password: MEMBER,
      ageConfirmed: true, termsAccepted: true, identityConsent: true,
    });
    const response = await request("/api/members/signup", { method: "POST", ...prepared });
    assert.equal(response.status, 201, await response.clone().text());
    return { member: (await response.json()).member, cookie: cookieValue(response, "lc_member") };
  }
  async function feed(cookie = adminCookie, query = "") {
    const response = await request(FEED + query, { cookie });
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get("cache-control"), /no-store/);
    return response.json();
  }
  return {
    request, login, signup, feed, images, dbPath, adminCookie, staffCookie,
    get base() { return base; },
    restart: async () => { await stop(); await start(); },
  };
}

test("account notifications are private to authenticated administrators and staff and reject cross-site read mutations", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  const admin = await f.feed();
  const worker = await f.feed(f.staffCookie);
  assert.equal(admin.notifications.length, 1);
  assert.equal(worker.notifications[0].id, admin.notifications[0].id);
  const id = admin.notifications[0].id;
  for (const cookie of [undefined, applicant.cookie]) {
    assert.equal((await f.request(FEED, { cookie })).status, 401);
    assert.equal((await f.request(`${FEED}/${id}/read`, { method: "POST", cookie, body: {} })).status, 401);
    assert.equal((await f.request(`${FEED}/read-all`, {
      method: "POST", cookie, body: { through: admin.latestSequence },
    })).status, 401);
  }
  const forgedOrigin = await f.request(`${FEED}/read-all`, {
    method: "POST", cookie: f.adminCookie,
    headers: { Origin: "https://unrelated.example.test" },
    body: { through: admin.latestSequence },
  });
  assert.equal(forgedOrigin.status, 403);
  assert.equal((await f.feed()).unreadCount, 1);
  for (const query of ["?limit=0", "?limit=51", "?before=not-a-sequence"])
    assert.equal((await f.request(FEED + query, { cookie: f.adminCookie })).status, 422, query);
});

test("only a committed successful registration publishes an application notification", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup("committed-notification@example.test");
  let current = await f.feed();
  assert.equal(current.total, 1);
  assert.equal(current.notifications[0].type, "member_registered");
  assert.equal(current.notifications[0].memberId, applicant.member.id);
  const firstId = current.notifications[0].id;

  const duplicate = await prepareSignup(f.request, {
    name: "Local duplicate applicant", email: applicant.member.email, password: MEMBER,
    ageConfirmed: true, termsAccepted: true, identityConsent: true,
  });
  assert.equal((await f.request("/api/members/signup", { method: "POST", ...duplicate })).status, 409);
  const underage = await prepareSignup(f.request, {
    name: "Local rejected applicant", email: "rejected-notification@example.test", password: MEMBER,
    ageConfirmed: true, termsAccepted: true, identityConsent: true, birthDate: "2015-01-01",
  });
  assert.equal((await f.request("/api/members/signup", { method: "POST", ...underage })).status, 422);

  const db = new DatabaseSync(f.dbPath);
  try {
    db.exec(`CREATE TRIGGER fail_notification_signup BEFORE INSERT ON member_sessions
      WHEN (SELECT email FROM members WHERE id=NEW.member_id)='rollback-notification@example.test'
      BEGIN SELECT RAISE(ABORT,'isolated late signup failure'); END;`);
    const failed = await prepareSignup(f.request, {
      name: "Local rollback applicant", email: "rollback-notification@example.test", password: MEMBER,
      ageConfirmed: true, termsAccepted: true, identityConsent: true,
    });
    assert.equal((await f.request("/api/members/signup", { method: "POST", ...failed })).status, 500);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM members WHERE email='rollback-notification@example.test'").get().count, 0);
  } finally { db.close(); }
  current = await f.feed();
  assert.equal(current.total, 1);
  assert.equal(current.notifications[0].id, firstId);
});

test("verification and actual profile changes publish safe current-status notifications without identity evidence", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup("private-notification@example.test", "Local private applicant");
  const invalidUpload = await f.request("/api/members/identity-verification", {
    method: "POST", cookie: applicant.cookie,
    body: { ...f.images.body, document: { data: "not-a-valid-image" } },
  });
  assert.equal(invalidUpload.status, 422);
  assert.equal((await f.feed()).total, 1);

  const uploaded = await f.request("/api/members/identity-verification", {
    method: "POST", cookie: applicant.cookie, body: f.images.body,
  });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const verification = (await uploaded.json()).verification;
  let current = await f.feed();
  assert.equal(current.total, 2);
  assert.equal(current.notifications[0].type, "verification_requested");
  assert.equal(current.notifications[0].target, "age");
  const reviewBody = {
    method: "uploaded_id_selfie", decision: "verified", identityChecked: true, ageChecked: true,
    expectedSubmittedAt: applicant.member.ageVerification.submittedAt,
    expectedUploadId: verification.uploadId,
  };
  const reviewPath = `/api/admin/members/${applicant.member.id}/age-verification`;
  assert.equal((await f.request(reviewPath, {
    method: "POST", cookie: f.staffCookie, body: { ...reviewBody, expectedUploadId: randomUUID() },
  })).status, 409);
  assert.equal((await f.feed()).total, 2);
  const reviewed = await f.request(reviewPath, { method: "POST", cookie: f.staffCookie, body: reviewBody });
  assert.equal(reviewed.status, 200, await reviewed.clone().text());
  assert.equal((await f.feed()).notifications[0].type, "verification_reviewed");
  assert.equal((await f.request(reviewPath, { method: "POST", cookie: f.staffCookie, body: reviewBody })).status, 409);

  const update = (body) => f.request("/api/members/me", { method: "PATCH", cookie: applicant.cookie, body });
  assert.equal((await update({ favorites: [] })).status, 200);
  assert.equal((await update({ name: applicant.member.name })).status, 200);
  assert.equal((await f.feed()).total, 3, "Saving favourites or an unchanged name should not create staff alerts.");
  assert.equal((await update({ name: "Local renamed applicant" })).status, 200);
  current = await f.feed();
  assert.equal(current.total, 4);
  assert.equal(current.notifications[0].type, "member_profile_updated");
  assert.equal(current.notifications[0].memberName, "Local renamed applicant");

  const resubmission = await prepareSignup(f.request, {
    birthDate: "2000-01-01", verificationConsent: true, ageConfirmed: true,
  }, { Cookie: applicant.cookie });
  const resubmitted = await f.request("/api/members/age-verification", { method: "POST", ...resubmission });
  assert.equal(resubmitted.status, 200, await resubmitted.clone().text());
  current = await f.feed();
  assert.equal(current.total, 5);
  assert.equal(current.notifications.filter((entry) => entry.type === "verification_requested").length, 2);
  const payload = JSON.stringify(current);
  for (const sensitive of [applicant.member.email, MEMBER, "2000-01-01", f.images.body.document.data, f.images.body.selfie.data])
    assert.equal(payload.includes(sensitive), false, "Notification payload must exclude identity evidence and credentials.");
  for (const event of current.notifications) {
    for (const key of Object.keys(event))
      assert.ok(["id", "sequence", "type", "title", "message", "memberId", "memberName", "target", "createdAt", "readAt"].includes(key), key);
  }
});

test("read receipts remain personal across sessions and restarts and mark-all cannot swallow a later arrival", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 3; index++) await f.signup(`personal-${index}@example.test`);
  const admin = await f.feed();
  const first = admin.notifications[0];
  assert.equal((await f.request(`${FEED}/${first.id}/read`, { method: "POST", cookie: f.adminCookie, body: {} })).status, 200);
  assert.equal((await f.feed()).unreadCount, 2);
  assert.equal((await f.feed(f.staffCookie)).unreadCount, 3);
  const freshAdmin = await f.login("admin", ADMIN);
  assert.equal((await f.feed(freshAdmin)).notifications.find((event) => event.id === first.id).readAt !== null, true);

  const snapshot = await f.feed(f.staffCookie);
  const later = await f.signup("later-notification@example.test");
  assert.equal((await f.request(`${FEED}/read-all`, {
    method: "POST", cookie: f.staffCookie, body: { through: snapshot.latestSequence },
  })).status, 200);
  const unread = await f.feed(f.staffCookie, "?unread=true");
  assert.equal(unread.unreadCount, 1);
  assert.equal(unread.notifications.length, 1);
  assert.equal(unread.notifications[0].memberId, later.member.id);

  const firstPage = await f.feed(f.staffCookie, "?limit=2");
  assert.equal(firstPage.notifications.length, 2);
  assert.ok(firstPage.nextCursor);
  const secondPage = await f.feed(f.staffCookie, `?limit=2&before=${firstPage.nextCursor}`);
  assert.equal(secondPage.notifications.length, 2);
  assert.equal(new Set([...firstPage.notifications, ...secondPage.notifications].map((event) => event.id)).size, 4);
  const ids = (await f.feed(freshAdmin)).notifications.map((event) => event.id);
  await f.restart();
  assert.equal((await f.request(FEED, { cookie: freshAdmin })).status, 401);
  const restartedAdmin = await f.login("admin", ADMIN);
  const restartedStaff = await f.login("staff", STAFF);
  const afterRestart = await f.feed(restartedAdmin);
  assert.deepEqual(afterRestart.notifications.map((event) => event.id), ids, "Restart must not backfill or duplicate historic applications.");
  assert.equal(afterRestart.unreadCount, 3);
  assert.equal((await f.feed(restartedStaff)).unreadCount, 1);
});

test("administrator and member account deletion remove linked notifications from both staff inboxes", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup("delete-notification@example.test");
  const retained = await f.signup("retained-notification@example.test");
  assert.equal((await f.request("/api/members/identity-verification", {
    method: "POST", cookie: applicant.cookie, body: f.images.body,
  })).status, 200);
  const snapshot = await f.feed();
  const removedId = snapshot.notifications.find((event) => event.memberId === applicant.member.id).id;
  assert.equal((await f.request(`${FEED}/read-all`, {
    method: "POST", cookie: f.adminCookie, body: { through: snapshot.latestSequence },
  })).status, 200);
  const directory = await f.request("/api/admin/members", { cookie: f.adminCookie });
  const row = (await directory.json()).members.find((member) => member.id === applicant.member.id);
  const deleted = await f.request(`/api/admin/members/${row.id}`, {
    method: "DELETE", cookie: f.adminCookie,
    body: { confirmEmail: row.email, expectedUpdatedAt: row.updatedAt },
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  for (const cookie of [f.adminCookie, f.staffCookie]) {
    const current = await f.feed(cookie);
    assert.equal(current.total, 1);
    assert.equal(current.notifications[0].memberId, retained.member.id);
    assert.equal(current.notifications.some((event) => event.memberId === applicant.member.id), false);
  }
  assert.equal((await f.request(`${FEED}/${removedId}/read`, { method: "POST", cookie: f.adminCookie, body: {} })).status, 404);
  assert.equal((await f.request("/api/members/me", { method: "DELETE", cookie: retained.cookie, body: { password: MEMBER } })).status, 200);
  assert.equal((await f.feed()).total, 0);
  assert.equal((await f.feed(f.staffCookie)).unreadCount, 0);
});

test("individual employees have distinct receipts and disabling their account immediately blocks notification access", async (t) => {
  const f = await fixture(t);
  await f.signup();
  const employees = [];
  for (const suffix of ["one", "two"]) {
    const created = await f.request("/api/admin/staff", {
      method: "POST", cookie: f.adminCookie,
      body: { name: `Local reviewer ${suffix}`, username: `notification.${suffix}`, password: EMPLOYEE },
    });
    assert.equal(created.status, 201, await created.clone().text());
    employees.push((await created.json()).staff);
  }
  const firstCookie = await f.login(employees[0].username, EMPLOYEE);
  const secondCookie = await f.login(employees[1].username, EMPLOYEE);
  const firstFeed = await f.feed(firstCookie);
  assert.equal((await f.request(`${FEED}/${firstFeed.notifications[0].id}/read`, {
    method: "POST", cookie: firstCookie, body: {},
  })).status, 200);
  assert.equal((await f.feed(firstCookie)).unreadCount, 0);
  assert.equal((await f.feed(secondCookie)).unreadCount, 1);
  const disable = await f.request(`/api/admin/staff/${employees[0].id}`, {
    method: "PATCH", cookie: f.adminCookie,
    body: { revision: employees[0].revision, active: false },
  });
  assert.equal(disable.status, 200, await disable.clone().text());
  const disabled = (await disable.json()).staff;
  assert.equal((await f.request(FEED, { cookie: firstCookie })).status, 401);
  assert.equal((await f.request(`${FEED}/read-all`, {
    method: "POST", cookie: firstCookie, body: { through: firstFeed.latestSequence },
  })).status, 401);
  assert.equal((await f.feed(secondCookie)).unreadCount, 1);
  const enable = await f.request(`/api/admin/staff/${disabled.id}`, {
    method: "PATCH", cookie: f.adminCookie, body: { revision: disabled.revision, active: true },
  });
  assert.equal(enable.status, 200);
  const resumedCookie = await f.login(employees[0].username, EMPLOYEE);
  assert.equal((await f.feed(resumedCookie)).unreadCount, 0);
});

test("logout during a slow notification read request cannot commit a stale authenticated mutation", async (t) => {
  const f = await fixture(t);
  await f.signup();
  const snapshot = await f.feed();
  const id = snapshot.notifications[0].id;
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  const responsePromise = fetch(f.base + `${FEED}/${id}/read`, {
    method: "POST", duplex: "half",
    headers: { "Content-Type": "application/json", Cookie: f.adminCookie },
    body: (async function* () { yield "{"; await paused; yield "}"; })(),
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  try {
    const logout = await f.request("/api/admin/logout", { method: "POST", cookie: f.adminCookie, body: {} });
    assert.equal(logout.status, 200);
  } finally { release(); }
  assert.equal((await responsePromise).status, 401);
  const cookie = await f.login("admin", ADMIN);
  const after = await f.feed(cookie);
  assert.equal(after.unreadCount, 1);
  assert.equal(after.notifications[0].readAt, null);
});
