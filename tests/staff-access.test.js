import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/app.mjs";
import { prepareSignup, cookieValue } from "./helpers/age-fixture.mjs";
import { identityFixture } from "./helpers/identity-fixture.mjs";

// Isolated local fixtures. These are not hosting credentials or real IDs.
const ADMIN_PASSWORD = "Local individual-staff administrator password 42";
const EMPLOYEE_PASSWORD = "Local individual-staff employee password 84";
const NEW_PASSWORD = "Local individual-staff replacement password 96";
const MEMBER_PASSWORD = "Local individual-staff member password 28";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "cana-individual-staff-"));
  const images = await identityFixture();
  const server = createServer({
    dbPath: join(directory, "staff.sqlite"), adminPassword: ADMIN_PASSWORD,
    identityConfig: images.config,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { body, cookie, headers, ...init } = {}) => fetch(base + path, {
    ...init,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = async (identifier, password) => request("/api/auth/login", {
    method: "POST", body: { identifier, password },
  });
  const admin = await login("admin", ADMIN_PASSWORD);
  assert.equal(admin.status, 200, await admin.clone().text());
  assert.equal((await admin.json()).role, "admin");
  return { request, login, images, adminCookie: cookieValue(admin, "lc_staff") };
}

async function employee(f) {
  const response = await f.request("/api/admin/staff", { method: "POST", cookie: f.adminCookie,
    body: { name: "Local Review Employee", username: "review.employee", password: EMPLOYEE_PASSWORD } });
  assert.equal(response.status, 201, await response.clone().text());
  const staff = (await response.json()).staff;
  assert.equal(staff.role, "staff");
  assert.equal(staff.active, true);
  return staff;
}

async function member(f) {
  const prepared = await prepareSignup(f.request, { name: "Local Uploaded Applicant", email: "staff-review-applicant@example.test",
    password: MEMBER_PASSWORD, ageConfirmed: true, termsAccepted: true, identityConsent: true });
  const signup = await f.request("/api/members/signup", { method: "POST", ...prepared });
  assert.equal(signup.status, 201, await signup.clone().text());
  return { member: (await signup.json()).member, cookie: cookieValue(signup, "lc_member") };
}

test("only administrators can create or manage individual staff and account responses never expose credentials", async (t) => {
  const f = await fixture(t);
  const applicant = await member(f);
  const staff = await employee(f);
  const signedIn = await f.login(staff.username, EMPLOYEE_PASSWORD);
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  const workerCookie = cookieValue(signedIn, "lc_staff");
  for (const cookie of [undefined, applicant.cookie]) {
    assert.equal((await f.request("/api/admin/staff", { cookie })).status, 401);
    assert.equal((await f.request("/api/admin/staff", { method: "POST", cookie,
      body: { name: "Not allowed", username: "not.allowed", password: EMPLOYEE_PASSWORD } })).status, 401);
  }
  assert.equal((await f.request("/api/admin/staff", { cookie: workerCookie })).status, 403);
  assert.equal((await f.request(`/api/admin/staff/${staff.id}`, { method: "PATCH", cookie: workerCookie,
    body: { revision: staff.revision, active: false } })).status, 403);
  assert.equal((await f.request("/api/admin/staff", { method: "POST", cookie: f.adminCookie,
    body: { name: "Forged administrator", username: "forged.admin", password: EMPLOYEE_PASSWORD, role: "admin" } })).status, 422);
  const listing = await f.request("/api/admin/staff?page=1&limit=20", { cookie: f.adminCookie });
  assert.equal(listing.status, 200, await listing.clone().text());
  const data = await listing.json();
  assert.equal(data.total, 1);
  assert.equal(data.staff[0].id, staff.id);
  assert.ok(!/password|salt|credential.?version/i.test(JSON.stringify(data)));
  assert.equal((await f.request("/api/admin/staff?page=0", { cookie: f.adminCookie })).status, 422);
  assert.equal((await f.request("/api/admin/staff?limit=1000", { cookie: f.adminCookie })).status, 422);
});

test("an administrator-created employee signs in on the shared endpoint and approves a real pending local application", async (t) => {
  const f = await fixture(t);
  const staff = await employee(f);
  const response = await f.login(" REVIEW.EMPLOYEE ", EMPLOYEE_PASSWORD);
  assert.equal(response.status, 200, await response.clone().text());
  const authentication = await response.json();
  assert.equal(authentication.role, "staff");
  assert.equal(authentication.user.id, staff.id);
  const workerCookie = cookieValue(response, "lc_staff");
  assert.equal(cookieValue(response, "lc_member"), "");
  assert.equal((await f.request("/api/admin/overview", { cookie: workerCookie })).status, 403);
  const applicant = await member(f);
  const memberLogin = await f.login(applicant.member.email, MEMBER_PASSWORD);
  assert.equal(memberLogin.status, 200, await memberLogin.clone().text());
  assert.equal((await memberLogin.json()).role, "member");
  assert.equal(cookieValue(memberLogin, "lc_staff"), "");
  const uploaded = await f.request("/api/members/identity-verification", { method: "POST", cookie: applicant.cookie, body: f.images.body });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const queue = await f.request("/api/admin/members/age-verifications?status=pending", { cookie: workerCookie });
  assert.equal(queue.status, 200, await queue.clone().text());
  const pending = (await queue.json()).members.find((row) => row.id === applicant.member.id);
  assert.ok(pending);
  const photo = await f.request(`/api/admin/members/${pending.id}/identity-documents/document?uploadId=${pending.identityVerification.uploadId}`, { cookie: workerCookie });
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get("cache-control"), /no-store/);
  const decision = await f.request(`/api/admin/members/${pending.id}/age-verification`, { method: "POST", cookie: workerCookie,
    body: { method: "uploaded_id_selfie", decision: "verified", expectedSubmittedAt: pending.ageVerification.submittedAt,
      expectedUploadId: pending.identityVerification.uploadId, identityChecked: true, ageChecked: true } });
  assert.equal(decision.status, 200, await decision.clone().text());
  const checked = (await decision.json()).member;
  assert.equal(checked.ageVerification.status, "verified");
  assert.equal(checked.identityVerification.status, "verified");
  assert.equal((await f.request(`/api/admin/members/${pending.id}/identity-documents/selfie`, { cookie: workerCookie })).status, 404);
  assert.equal((await f.request("/api/admin/overview", { cookie: applicant.cookie })).status, 401);
});

test("resetting or disabling an employee immediately revokes every old session without revoking the administrator", async (t) => {
  const f = await fixture(t);
  let staff = await employee(f);
  const signedIn = await Promise.all([f.login(staff.username, EMPLOYEE_PASSWORD), f.login(staff.username, EMPLOYEE_PASSWORD)]);
  const oldCookies = signedIn.map((response) => cookieValue(response, "lc_staff"));
  for (const response of signedIn) assert.equal(response.status, 200);
  const reset = await f.request(`/api/admin/staff/${staff.id}`, { method: "PATCH", cookie: f.adminCookie,
    body: { revision: staff.revision, password: NEW_PASSWORD } });
  assert.equal(reset.status, 200, await reset.clone().text());
  const staleRevision = staff.revision;
  staff = (await reset.json()).staff;
  for (const cookie of oldCookies) assert.equal((await f.request("/api/admin/members", { cookie })).status, 401);
  assert.equal((await f.login(staff.username, EMPLOYEE_PASSWORD)).status, 401);
  assert.equal((await f.request(`/api/admin/staff/${staff.id}`, { method: "PATCH", cookie: f.adminCookie,
    body: { revision: staleRevision, active: false } })).status, 409);
  const fresh = await f.login(staff.username, NEW_PASSWORD);
  assert.equal(fresh.status, 200, await fresh.clone().text());
  const freshCookie = cookieValue(fresh, "lc_staff");
  const disable = await f.request(`/api/admin/staff/${staff.id}`, { method: "PATCH", cookie: f.adminCookie,
    body: { revision: staff.revision, active: false } });
  assert.equal(disable.status, 200, await disable.clone().text());
  staff = (await disable.json()).staff;
  assert.equal((await f.request("/api/admin/session", { cookie: freshCookie })).status, 401);
  assert.equal((await f.login(staff.username, NEW_PASSWORD)).status, 401);
  assert.equal((await f.request("/api/admin/overview", { cookie: f.adminCookie })).status, 200);
  const enable = await f.request(`/api/admin/staff/${staff.id}`, { method: "PATCH", cookie: f.adminCookie,
    body: { revision: staff.revision, active: true } });
  assert.equal(enable.status, 200, await enable.clone().text());
  const resumed = await f.login(staff.username, NEW_PASSWORD);
  assert.equal(resumed.status, 200, await resumed.clone().text());
  assert.equal((await resumed.json()).role, "staff");
});

test("shared sign-in cookies reach the shared endpoint and switching accounts revokes the previous identity", async (t) => {
  const f = await fixture(t);
  const staff = await employee(f);
  const applicant = await member(f);
  const employeeLogin = await f.request("/api/auth/login", {
    method: "POST", cookie: f.adminCookie,
    body: { identifier: staff.username, password: EMPLOYEE_PASSWORD },
  });
  assert.equal(employeeLogin.status, 200);
  const cookies = employeeLogin.headers.getSetCookie();
  assert.ok(cookies.some((value) => /^lc_staff=[A-Za-z0-9_-]+; Path=\/api;/.test(value)));
  assert.ok(cookies.some((value) => value.startsWith("lc_staff=; Path=/api/admin;") && value.includes("Max-Age=0")));
  const employeeCookie = cookieValue(employeeLogin, "lc_staff");
  assert.equal((await f.request("/api/admin/overview", { cookie: f.adminCookie })).status, 401);
  assert.equal((await f.request("/api/admin/members", { cookie: employeeCookie })).status, 200);

  const memberLogin = await f.request("/api/auth/login", {
    method: "POST", cookie: employeeCookie,
    body: { identifier: applicant.member.email, password: MEMBER_PASSWORD },
  });
  assert.equal(memberLogin.status, 200);
  const memberCookie = cookieValue(memberLogin, "lc_member");
  assert.equal((await f.request("/api/admin/members", { cookie: employeeCookie })).status, 401);
  assert.equal((await (await f.request("/api/members/me", { cookie: memberCookie })).json()).member.id, applicant.member.id);

  const switchedBack = await f.request("/api/auth/login", {
    method: "POST", cookie: memberCookie,
    body: { identifier: staff.username, password: EMPLOYEE_PASSWORD },
  });
  assert.equal(switchedBack.status, 200);
  assert.equal((await (await f.request("/api/members/me", { cookie: memberCookie })).json()).member, null);
});
