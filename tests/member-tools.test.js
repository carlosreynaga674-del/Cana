import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "../server/app.mjs";
import { prepareSignup, cookieValue } from "./helpers/age-fixture.mjs";
import { identityFixture } from "./helpers/identity-fixture.mjs";

// Local-only credentials and synthetic images; no production mail or data.
const ADMIN = "Local member-tools administrator password 42";
const STAFF = "Local member-tools employee password 84";
const PASSWORD = "Local member-tools customer password 96";
const business = {
  businessName: "Local Member Tools Fixture",
  businessJurisdiction: "Local isolated test fixture only",
  storeLicenseNumber: "LOCAL-TEST-NOT-A-LICENCE",
  deliveryZips: ["2196"],
  pickupAddress: "Local isolated fixture address",
  contactEmail: "local@example.test",
  liveOrdersEnabled: true,
  legalSalesAuthorizationConfirmed: true,
  catalogApproved: true,
};

async function fixture(t, { mailConfig = {}, mailTransport } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cana-member-tools-"));
  const dbPath = join(directory, "test.sqlite");
  const images = await identityFixture();
  let server, base;
  async function start() {
    server = createServer({
      dbPath, adminPassword: ADMIN, staffPassword: STAFF,
      identityConfig: images.config, config: business,
      mailConfig, mailTransport,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, { body, cookie, headers, ...init } = {}) => fetch(base + path, {
    ...init,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = async (identifier, password) => {
    const response = await request("/api/auth/login", { method: "POST", body: { identifier, password } });
    assert.equal(response.status, 200, await response.clone().text());
    return cookieValue(response, identifier.includes("@") ? "lc_member" : "lc_staff");
  };
  const adminCookie = await login("admin", ADMIN);
  const staffCookie = await login("staff", STAFF);
  async function signup(email = "member-tools@example.test") {
    const prepared = await prepareSignup(request, {
      name: "Local Member Tools Applicant", email, password: PASSWORD,
      ageConfirmed: true, termsAccepted: true, identityConsent: true,
    });
    const response = await request("/api/members/signup", { method: "POST", ...prepared });
    assert.equal(response.status, 201, await response.clone().text());
    return { member: (await response.json()).member, cookie: cookieValue(response, "lc_member") };
  }
  const directoryMember = async (id, cookie = adminCookie) => {
    const response = await request("/api/admin/members", { cookie });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).members.find((member) => member.id === id);
  };
  return { request, signup, directoryMember, login, adminCookie, staffCookie, images, dbPath, get base() { return base; }, restart: async () => { await stop(); await start(); } };
}

test("successful HTTP signup queues one actual welcome through the injected sender while failed signup rolls the job back", async (t) => {
  const messages = [];
  const f = await fixture(t, {
    mailConfig: { provider: "smtp", from: "Loud + Cana <sender@example.test>", publicOrigin: "https://local-store.example.test",
      smtpHost: "smtp.example.test", smtpPort: 587, smtpUser: "sender@example.test", smtpPassword: "Local injected SMTP fixture only" },
    mailTransport: { async sendMail(message) { messages.push(message); return { accepted: [message.to] }; } },
  });
  const applicant = await f.signup();
  let current;
  const deadline = Date.now() + 3000;
  do {
    current = await f.directoryMember(applicant.member.id);
    if (current.welcomeEmail.status === "sent") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.equal(current.welcomeEmail.status, "sent");
  assert.equal(current.ageVerification.status, "pending", "A welcome email cannot approve identity.");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, applicant.member.email);
  assert.match(messages[0].text, /does not by itself verify your identity/);
  assert.ok(!JSON.stringify(messages[0]).includes(PASSWORD));
  const duplicateDetails = await prepareSignup(f.request, { name: "Local duplicate fixture", email: applicant.member.email,
    password: PASSWORD, ageConfirmed: true, termsAccepted: true, identityConsent: true });
  const duplicate = await f.request("/api/members/signup", { method: "POST", ...duplicateDetails });
  assert.equal(duplicate.status, 409);

  const db = new DatabaseSync(f.dbPath);
  db.exec(`CREATE TRIGGER fail_local_mail_signup BEFORE INSERT ON member_sessions
    WHEN (SELECT email FROM members WHERE id=NEW.member_id)='rollback-mail@example.test'
    BEGIN SELECT RAISE(ABORT,'isolated session-storage failure'); END;`);
  const failedDetails = await prepareSignup(f.request, { name: "Local rollback fixture", email: "rollback-mail@example.test",
    password: PASSWORD, ageConfirmed: true, termsAccepted: true, identityConsent: true });
  const failed = await f.request("/api/members/signup", { method: "POST", ...failedDetails });
  assert.equal(failed.status, 500);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM members WHERE email='rollback-mail@example.test'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM member_welcome_outbox").get().count, 1);
  assert.equal(messages.length, 1, "Duplicate or rolled-back registrations must not trigger welcome emails.");
  db.close();
});

test("admin member deletion requires typed confirmation and current details, removes private account data and revokes all sessions", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  const secondCookie = await f.login(applicant.member.email, PASSWORD);
  const upload = await f.request("/api/members/identity-verification", {
    method: "POST", cookie: applicant.cookie, body: f.images.body,
  });
  assert.equal(upload.status, 200, await upload.clone().text());
  const row = await f.directoryMember(applicant.member.id);
  assert.equal(typeof row.updatedAt, "string");
  assert.equal(row.welcomeEmail.status, "pending");
  assert.notEqual(row.welcomeEmail.status, "sent", "An unconfigured mail sender cannot claim success.");
  const path = `/api/admin/members/${row.id}`;
  const confirmation = { expectedUpdatedAt: row.updatedAt, confirmEmail: row.email };
  for (const cookie of [undefined, applicant.cookie])
    assert.equal((await f.request(path, { method: "DELETE", cookie, body: confirmation })).status, 401);
  assert.equal((await f.request(path, { method: "DELETE", cookie: f.staffCookie, body: confirmation })).status, 403);
  assert.equal((await f.request(path, { method: "DELETE", cookie: f.adminCookie, body: { ...confirmation, confirmEmail: "someone-else@example.test" } })).status, 422);
  assert.equal((await f.request(path, { method: "DELETE", cookie: f.adminCookie, body: { ...confirmation, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" } })).status, 409);
  const deleted = await f.request(path, { method: "DELETE", cookie: f.adminCookie, body: confirmation });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  assert.equal((await deleted.json()).ok, true);
  assert.equal(await f.directoryMember(row.id), undefined);
  for (const cookie of [applicant.cookie, secondCookie])
    assert.equal((await (await f.request("/api/members/me", { cookie })).json()).member, null);
  const login = await f.request("/api/auth/login", { method: "POST", body: { identifier: row.email, password: PASSWORD } });
  assert.equal(login.status, 401);
  const db = new DatabaseSync(f.dbPath);
  for (const table of ["member_sessions", "member_age_checks", "member_age_audit", "member_identity_uploads", "member_welcome_outbox"])
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_id=?`).get(row.id).count, 0, table);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM members WHERE id=?").get(row.id).count, 0);
  db.close();
});

test("deleting a verified member preserves separately retained order and private tracking records", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  assert.equal((await f.request("/api/members/identity-verification", { method: "POST", cookie: applicant.cookie, body: f.images.body })).status, 200);
  const queue = await f.request("/api/admin/members/age-verifications?status=pending", { cookie: f.staffCookie });
  const pending = (await queue.json()).members.find((row) => row.id === applicant.member.id);
  const review = await f.request(`/api/admin/members/${pending.id}/age-verification`, {
    method: "POST", cookie: f.staffCookie,
    body: { method: "uploaded_id_selfie", decision: "verified", expectedSubmittedAt: pending.ageVerification.submittedAt,
      expectedUploadId: pending.identityVerification.uploadId, identityChecked: true, ageChecked: true },
  });
  assert.equal(review.status, 200, await review.clone().text());
  const created = await f.request("/api/orders", { method: "POST", cookie: applicant.cookie, body: {
    fulfillment: "pickup", ageConfirmed: true,
    customer: { name: "Local Member Tools Applicant", email: applicant.member.email, phone: "0712345678" },
    items: [{ productId: "sunset-sherbet", sizeIndex: 0, quantity: 1 }],
  } });
  assert.equal(created.status, 201, await created.clone().text());
  const { order, trackingToken } = await created.json();
  const current = await f.directoryMember(pending.id);
  assert.equal((await f.request(`/api/admin/members/${current.id}`, { method: "DELETE", cookie: f.adminCookie,
    body: { expectedUpdatedAt: current.updatedAt, confirmEmail: current.email } })).status, 200);
  const tracked = await f.request(`/api/orders/${order.id}`, { headers: { Authorization: `Bearer ${trackingToken}` } });
  assert.equal(tracked.status, 200);
  assert.equal((await tracked.json()).order.id, order.id);
  const staffOrders = await f.request("/api/admin/orders", { cookie: f.staffCookie });
  assert.ok((await staffOrders.json()).orders.some((row) => row.id === order.id));
});

test("revoking an administrator while a deletion body arrives cannot delete a registered account", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  const row = await f.directoryMember(applicant.member.id);
  const body = JSON.stringify({ expectedUpdatedAt: row.updatedAt, confirmEmail: row.email });
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  const responsePromise = fetch(f.base + `/api/admin/members/${row.id}`, {
    method: "DELETE", duplex: "half", headers: { "Content-Type": "application/json", Cookie: f.adminCookie },
    body: (async function* () { yield body.slice(0, 12); await paused; yield body.slice(12); })(),
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  try {
    const logout = await f.request("/api/admin/logout", { method: "POST", cookie: f.adminCookie, body: {} });
    assert.equal(logout.status, 200);
  } finally { release(); }
  assert.equal((await responsePromise).status, 401);
  const me = await f.request("/api/members/me", { cookie: applicant.cookie });
  assert.equal((await me.json()).member.id, row.id);
});

test("uploaded product photos stay private for drafts, appear after publication and survive restart without exposing archived images", async (t) => {
  const f = await fixture(t);
  const applicant = await f.signup();
  const image = { image: { data: f.images.document.toString("base64") } };
  for (const cookie of [undefined, applicant.cookie])
    assert.equal((await f.request("/api/admin/product-images", { method: "POST", cookie, body: image })).status, 401);
  const uploaded = await f.request("/api/admin/product-images", { method: "POST", cookie: f.staffCookie, body: image });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const media = (await uploaded.json()).image;
  assert.match(media.url, /^\/media\/products\/[a-f0-9-]+\.webp$/);
  assert.equal((await f.request(media.previewUrl)).status, 401);
  const privatePhoto = await f.request(media.previewUrl, { cookie: f.staffCookie });
  assert.equal(privatePhoto.status, 200);
  assert.match(privatePhoto.headers.get("cache-control"), /no-store/);
  assert.equal(privatePhoto.headers.get("content-type"), "image/webp");
  const original = Buffer.from(await privatePhoto.arrayBuffer());
  assert.ok(original.length > 100);
  assert.equal((await f.request(media.url)).status, 404);
  const created = await f.request("/api/admin/products", { method: "POST", cookie: f.staffCookie, body: {
    name: "Local Uploaded Product Photo", category: "Accessories", type: "Accessory", size: "One unit",
    description: "A synthetic local product image fixture, never a production product.", price: 12345, imageUrl: media.url,
  } });
  assert.equal(created.status, 201, await created.clone().text());
  let product = (await created.json()).product;
  assert.equal(product.imageUrl, media.url);
  assert.equal((await f.request(media.url)).status, 404);
  const published = await f.request(`/api/admin/products/${product.id}`, { method: "PATCH", cookie: f.staffCookie,
    body: { revision: product.revision, status: "published" } });
  assert.equal(published.status, 200, await published.clone().text());
  product = (await published.json()).product;
  const publicPhoto = await f.request(media.url);
  assert.equal(publicPhoto.status, 200);
  assert.deepEqual(Buffer.from(await publicPhoto.arrayBuffer()), original);
  await f.restart();
  const afterRestart = await f.request(media.url);
  assert.equal(afterRestart.status, 200);
  assert.deepEqual(Buffer.from(await afterRestart.arrayBuffer()), original);
  const staffCookie = await f.login("staff", STAFF);
  const archive = await f.request(`/api/admin/products/${product.id}`, { method: "PATCH", cookie: staffCookie,
    body: { revision: product.revision, status: "archived" } });
  assert.equal(archive.status, 200, await archive.clone().text());
  assert.equal((await f.request(media.url)).status, 404);
  assert.equal((await f.request(media.previewUrl, { cookie: staffCookie })).status, 200);
});
