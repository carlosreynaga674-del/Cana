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

// Isolated ordinary-merchandise records only. No live sales gate, mail or
// customer account is enabled, and tests never create a remote transaction.
const ADMIN = "Local merchandise report administrator password 42";
const STAFF = "Local merchandise report shared staff password 84";
const MEMBER = "Local merchandise rewards member password 96";
const EMPLOYEE = "Local merchandise report employee password 28";
const SETTINGS = "/api/admin/reports/processed-products";
const CREATE_REPORT_PRODUCT = "/api/admin/reports/products";
const REPORT = "/api/admin/reports/processed";
const PAYMENTS = "/api/admin/rewards/payments";
const OWN_REWARDS = "/api/members/rewards";
const JAR = "glass-storage-jar";
const TRAY = "ritual-rolling-tray";
const EXCLUDED = "sunset-sherbet";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "cana-merchandise-http-"));
  const dbPath = join(directory, "reports.sqlite");
  const server = createServer({
    dbPath, adminPassword: ADMIN, staffPassword: STAFF,
    config: { businessName: "Local ordinary merchandise fixture" }, mailConfig: {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  t.after(async () => {
    db.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, { body, cookie, headers, ...options } = {}) => fetch(base + path, {
    ...options,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}), ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function json(path, options = {}) {
    const response = await request(path, { cookie: adminCookie, ...options });
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get("cache-control"), /no-store/);
    return response.json();
  }
  async function login(identifier, password) {
    const response = await request("/api/auth/login", {
      method: "POST", body: { identifier, password },
    });
    assert.equal(response.status, 200, await response.clone().text());
    return cookieValue(response, identifier.includes("@") ? "lc_member" : "lc_staff");
  }
  const adminCookie = await login("admin", ADMIN);
  const staffCookie = await login("staff", STAFF);
  async function signup() {
    const prepared = await prepareSignup(request, {
      name: "Local merchandise member", email: randomUUID() + "@example.test",
      password: MEMBER, ageConfirmed: true, termsAccepted: true, identityConsent: true,
    });
    const response = await request("/api/members/signup", { method: "POST", ...prepared });
    assert.equal(response.status, 201, await response.clone().text());
    return { member: (await response.json()).member, cookie: cookieValue(response, "lc_member") };
  }
  let serial = 0;
  function line(id = JAR, price = 100000, quantity = 1, extra = {}) {
    return {
      id, productId: id, name: id === JAR ? "Local Glass Storage Box" : "Local Desk Tray",
      category: "Accessories", size: "Standard", sizeIndex: 0, price, quantity, ...extra,
    };
  }
  function seed(items = [line()], { status = "completed", updatedAt = new Date().toISOString(), discount = 0 } = {}) {
    const id = "LC-MERCH" + (++serial);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const totals = { subtotal, discount, delivery: 4900, total: subtotal - discount + 4900 };
    db.prepare("INSERT INTO orders (id,created_at,updated_at,status,fulfillment,customer_json,items_json,totals_json,notes,promo_code,tracking_hash,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, updatedAt, updatedAt, status, "pickup",
        JSON.stringify({ name: "Private fixture customer", email: "private-customer@example.test" }),
        JSON.stringify(items), JSON.stringify(totals), "Private customer note", "", "local-private-tracking", "local-private-request");
    return id;
  }
  async function choose(productIds) {
    const current = await json(SETTINGS);
    return json(SETTINGS, {
      method: "PUT", body: { productIds, expectedRevision: current.revision },
    });
  }
  const own = async (applicant) => (await json(OWN_REWARDS, { cookie: applicant.cookie })).rewards;
  const quote = async (orderId) => (await json("/api/admin/rewards/quote?orderId=" + orderId)).quote;
  async function confirm(orderId, applicant, redeemCents = 0, extra = {}) {
    const current = await quote(orderId);
    return json(PAYMENTS, {
      method: "POST", body: {
        orderId, membershipNumber: applicant.member.membershipNumber,
        confirmedPaid: true, redeemCents,
        expectedEligibleMerchandiseCents: current.eligibleMerchandiseCents, ...extra,
      },
    });
  }
  return {
    request, json, login, signup, line, seed, choose, own, quote, confirm,
    db, base, adminCookie, staffCookie,
  };
}

test("processed report settings and financial administration require the admin role", async (t) => {
  const f = await fixture(t);
  const member = await f.signup();
  const orderId = f.seed();
  for (const [cookie, expected] of [[undefined, 401], [member.cookie, 401], [f.staffCookie, 403]]) {
    for (const path of [SETTINGS, REPORT, "/api/admin/rewards/quote?orderId=" + orderId,
      "/api/admin/rewards/members/" + member.member.id]) {
      assert.equal((await f.request(path, { cookie })).status, expected, path);
    }
    assert.equal((await f.request(SETTINGS, {
      cookie, method: "PUT", body: { productIds: [JAR], expectedRevision: 1 },
    })).status, expected);
    assert.equal((await f.request(PAYMENTS, {
      cookie, method: "POST", body: {
        orderId, membershipNumber: member.member.membershipNumber,
        confirmedPaid: true, expectedEligibleMerchandiseCents: 100000,
      },
    })).status, expected);
  }
  assert.equal((await f.request(OWN_REWARDS)).status, 401);
  const current = await f.json(SETTINGS);
  assert.equal(current.scope, "non_cannabis_merchandise");
  assert.ok(current.products.some((product) => product.id === JAR));
  assert.ok(current.products.every((product) => ![EXCLUDED, "blue-dream-pre-roll"].includes(product.id)));
  for (const [path, method, body] of [
    [SETTINGS, "PUT", { productIds: [JAR], expectedRevision: current.revision }],
    [PAYMENTS, "POST", { orderId, membershipNumber: member.member.membershipNumber,
      confirmedPaid: true, expectedEligibleMerchandiseCents: 100000 }],
  ]) {
    assert.equal((await f.request(path, {
      cookie: f.adminCookie, method, body, headers: { Origin: "https://unrelated.example.test" },
    })).status, 403);
  }
  assert.equal((await f.own(member)).balanceCents, 0);
});

test("report product creation requires administrator access and same-origin requests", async (t) => {
  const f = await fixture(t);
  const member = await f.signup();
  const body = { name: "Local Linen Tote", price: 12550, size: "One bag", description: "Reusable linen merchandise carry bag." };
  const initialCount = f.db.prepare("SELECT count(*) AS total FROM catalog_products").get().total;
  for (const [cookie, expected] of [[undefined, 401], [member.cookie, 401], [f.staffCookie, 403]]) {
    assert.equal((await f.request(CREATE_REPORT_PRODUCT, { cookie, method: "POST", body })).status, expected);
  }
  assert.equal((await f.request(CREATE_REPORT_PRODUCT, {
    cookie: f.adminCookie, method: "POST", body,
    headers: { Origin: "https://unrelated.example.test" },
  })).status, 403);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM catalog_products").get().total, initialCount);
});

test("report product creation stores a validated private merchandise draft without replacing saved selections", async (t) => {
  const f = await fixture(t);
  const settings = await f.choose([JAR]);
  const body = { name: "Local Linen Tote", price: 12550, size: "One bag", description: "Reusable linen merchandise carry bag." };
  const initialCount = f.db.prepare("SELECT count(*) AS total FROM catalog_products").get().total;
  for (const invalid of [
    { ...body, name: "x" }, { ...body, price: 0 }, { ...body, price: 125.5 },
    { ...body, price: 100000001 }, { ...body, size: "" }, { ...body, description: "short" },
    { ...body, category: "Flower" }, { ...body, status: "published" }, { ...body, id: "caller-chosen-id" },
  ]) {
    const response = await f.request(CREATE_REPORT_PRODUCT, { cookie: f.adminCookie, method: "POST", body: invalid });
    assert.equal(response.status, 422, await response.clone().text());
  }
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM catalog_products").get().total, initialCount);
  const response = await f.request(CREATE_REPORT_PRODUCT, { cookie: f.adminCookie, method: "POST", body });
  assert.equal(response.status, 201, await response.clone().text());
  assert.match(response.headers.get("cache-control"), /no-store/);
  const { product } = await response.json();
  assert.equal(product.name, body.name);
  assert.equal(product.price, body.price);
  assert.equal(product.size, body.size);
  assert.equal(product.description, body.description);
  assert.equal(product.category, "Accessories");
  assert.equal(product.status, "draft");
  assert.equal(f.db.prepare("SELECT status FROM catalog_products WHERE id=?").get(product.id).status, "draft");
  const updatedSettings = await f.json(SETTINGS);
  assert.equal(updatedSettings.revision, settings.revision);
  assert.deepEqual(updatedSettings.selectedProductIds, [JAR]);
  assert.ok(updatedSettings.products.some((p) => p.id === product.id && p.status === "draft"));
  const publicCatalog = await f.json("/api/products", { cookie: undefined });
  assert.equal(publicCatalog.products.some((p) => p.id === product.id), false);
  await f.choose([JAR, product.id]);
  assert.deepEqual((await f.json(SETTINGS)).selectedProductIds, [JAR, product.id]);
  const published = await f.request("/api/admin/products/" + product.id, {
    cookie: f.adminCookie, method: "PATCH", body: { revision: product.revision, status: "published" },
  });
  assert.equal(published.status, 200, await published.clone().text());
  assert.ok((await f.json("/api/products", { cookie: undefined })).products.some((p) => p.id === product.id));
});

test("logout during a report product body prevents creation", async (t) => {
  const f = await fixture(t);
  const before = f.db.prepare("SELECT count(*) AS total FROM catalog_products").get().total;
  const bytes = JSON.stringify({ name: "Local Linen Tote", price: 12550, size: "One bag", description: "Reusable linen merchandise carry bag." });
  let finish;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bytes.slice(0, 15)));
      finish = () => { controller.enqueue(new TextEncoder().encode(bytes.slice(15))); controller.close(); };
    },
  });
  const pending = fetch(f.base + CREATE_REPORT_PRODUCT, {
    method: "POST", duplex: "half", body,
    headers: { Cookie: f.adminCookie, "Content-Type": "application/json" },
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal((await f.request("/api/admin/logout", { cookie: f.adminCookie, method: "POST", body: {} })).status, 200);
  finish();
  assert.equal((await pending).status, 401);
  assert.equal(f.db.prepare("SELECT count(*) AS total FROM catalog_products").get().total, before);
});

test("report product selections reject excluded items and preserve revision conflicts", async (t) => {
  const f = await fixture(t);
  const current = await f.json(SETTINGS);
  const saved = await f.choose([JAR]);
  assert.deepEqual(saved.selectedProductIds, [JAR]);
  const stale = await f.request(SETTINGS, {
    cookie: f.adminCookie, method: "PUT",
    body: { productIds: [TRAY], expectedRevision: current.revision },
  });
  assert.equal(stale.status, 409);
  const excluded = await f.request(SETTINGS, {
    cookie: f.adminCookie, method: "PUT",
    body: { productIds: [EXCLUDED], expectedRevision: saved.revision },
  });
  assert.equal(excluded.status, 422);
  assert.deepEqual((await f.json(SETTINGS)).selectedProductIds, [JAR]);
  f.seed([f.line(JAR, 10000, 2), f.line(TRAY, 20000, 4),
    f.line(EXCLUDED, 30000, 1, { category: "Flower", name: "Excluded fixture line" })]);
  const report = await f.json(REPORT);
  assert.equal(report.total, 1);
  assert.deepEqual(report.summary, { records: 1, units: 2 });
  const item = report.groups[0].records[0];
  assert.equal(item.staffName, "Not recorded");
  assert.equal(item.attribution, "not_recorded");
  assert.deepEqual(item.products.map((product) => product.id), [JAR]);
  assert.equal(report.timeZone, "Africa/Johannesburg");
  const payload = JSON.stringify(report);
  for (const forbidden of ["private-customer@example.test", "Private fixture customer",
    "Private customer note", "Excluded fixture line", EXCLUDED, TRAY])
    assert.equal(payload.includes(forbidden), false, forbidden);
});

test("ordinary merchandise completion records trusted individual staff names and rolls back audit failures", async (t) => {
  const f = await fixture(t);
  await f.choose([JAR]);
  const username = "merchandise.clerk";
  const created = await f.request("/api/admin/staff", {
    cookie: f.adminCookie, method: "POST",
    body: { name: "Local Receipt Clerk", username, password: EMPLOYEE },
  });
  assert.equal(created.status, 201, await created.clone().text());
  const employee = await f.login(username, EMPLOYEE);
  const orderId = f.seed([f.line()], { status: "ready_for_pickup" });
  const response = await f.request("/api/admin/orders/" + orderId, {
    cookie: employee, method: "PATCH",
    body: { status: "completed", staffName: "Caller cannot choose attribution" },
  });
  assert.equal(response.status, 200, await response.clone().text());
  let report = await f.json(REPORT);
  const row = report.groups.flatMap((group) => group.records).find((record) => record.id === orderId);
  assert.equal(row.staffName, "Local Receipt Clerk");
  assert.equal(row.staffUsername, username);
  assert.equal(row.attribution, "recorded");
  assert.equal(JSON.stringify(row).includes("Caller cannot choose attribution"), false);
  assert.equal((await f.request("/api/admin/orders/" + orderId, {
    cookie: f.adminCookie, method: "PATCH", body: { status: "completed" },
  })).status, 409, "A finished record cannot be attributed a second time.");
  const rejectedId = f.seed([f.line()], { status: "ready_for_pickup" });
  f.db.exec("CREATE TRIGGER fail_merchandise_event BEFORE INSERT ON processed_merchandise_events BEGIN SELECT RAISE(ABORT,'local report audit failure'); END;");
  const failed = await f.request("/api/admin/orders/" + rejectedId, {
    cookie: employee, method: "PATCH", body: { status: "completed" },
  });
  assert.equal(failed.status, 500);
  assert.equal(f.db.prepare("SELECT status FROM orders WHERE id=?").get(rejectedId).status, "ready_for_pickup");
  f.db.exec("DROP TRIGGER fail_merchandise_event");
  report = await f.json(REPORT);
  assert.equal(report.groups.flatMap((group) => group.records).some((record) => record.id === rejectedId), false);
});

test("processed report dates use South African days and selections cannot admit mismatched categories", async (t) => {
  const f = await fixture(t);
  await f.choose([JAR, TRAY]);
  const before = f.seed([f.line()], { updatedAt: "2026-01-04T21:59:59.999Z" });
  const first = f.seed([f.line()], { updatedAt: "2026-01-04T22:00:00.000Z" });
  const last = f.seed([f.line(TRAY)], { updatedAt: "2026-01-05T21:59:59.999Z" });
  const after = f.seed([f.line()], { updatedAt: "2026-01-05T22:00:00.000Z" });
  f.seed([f.line(JAR, 10000, 1, { category: "Flower" })], { updatedAt: "2026-01-05T12:00:00.000Z" });
  f.seed([f.line(EXCLUDED, 10000, 1, { category: "Accessories" })], { updatedAt: "2026-01-05T12:00:00.000Z" });
  const path = REPORT + "?from=2026-01-05&to=2026-01-05&limit=1";
  const page1 = await f.json(path);
  assert.equal(page1.total, 2);
  assert.deepEqual(page1.summary, { records: 2, units: 2 });
  assert.equal(page1.groups.length, 1);
  assert.equal(page1.groups[0].date, "2026-01-05");
  assert.equal(page1.groups[0].records[0].id, last);
  const page2 = await f.json(path + "&page=2");
  assert.equal(page2.groups[0].records[0].id, first);
  for (const absent of [before, after]) assert.equal(JSON.stringify([page1, page2]).includes(absent), false);
  for (const suffix of ["?from=2026-02-30", "?from=2026-01-06&to=2026-01-05", "?staffName=forged"]) {
    assert.equal((await f.request(REPORT + suffix, { cookie: f.adminCookie })).status, 422);
  }
});

test("member rewards require explicit admin payment confirmation, stay private and are idempotent", async (t) => {
  const f = await fixture(t);
  const first = await f.signup(), second = await f.signup();
  const orderId = f.seed([f.line()]);
  assert.equal((await f.own(first)).balanceCents, 0, "A completed record is not payment evidence.");
  const before = await f.quote(orderId);
  assert.equal(before.eligibleMerchandiseCents, 100000);
  assert.equal(before.paymentRecorded, false);
  const missingAttestation = await f.request(PAYMENTS, {
    cookie: f.adminCookie, method: "POST",
    body: { orderId, membershipNumber: first.member.membershipNumber,
      expectedEligibleMerchandiseCents: 100000, confirmedPaid: false },
  });
  assert.equal(missingAttestation.status, 422);
  const paid = await f.confirm(orderId, first);
  assert.equal(paid.rewards.balanceCents, 1000);
  assert.equal(paid.rewards.eligiblePaidSpendCents, 100000);
  assert.equal(paid.receipt.earnedCents, 1000);
  const duplicate = await f.confirm(orderId, first);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.rewards.balanceCents, 1000);
  assert.equal(duplicate.rewards.history.length, 1);
  assert.equal((await f.own(second)).balanceCents, 0);
  const spoofedOwn = await f.json(OWN_REWARDS + "?memberId=" + first.member.id, { cookie: second.cookie });
  assert.equal(spoofedOwn.rewards.balanceCents, 0);
  assert.equal((await f.request("/api/admin/rewards/members/" + first.member.id, { cookie: second.cookie })).status, 401);
  const ownPayload = JSON.stringify(await f.own(first));
  assert.equal(ownPayload.includes(second.member.email), false);
  assert.equal(ownPayload.includes(MEMBER), false);
  const inconsistentMember = await f.request(PAYMENTS, {
    cookie: f.adminCookie, method: "POST",
    body: { orderId, membershipNumber: second.member.membershipNumber,
      confirmedPaid: true, expectedEligibleMerchandiseCents: 100000, redeemCents: 0 },
  });
  assert.equal(inconsistentMember.status, 409);
});

test("reward redemption uses only eligible merchandise and awards only externally paid spend", async (t) => {
  const f = await fixture(t);
  const member = await f.signup();
  await f.confirm(f.seed([f.line()]), member);
  const mixed = f.seed([f.line(JAR, 50000, 2),
    f.line(EXCLUDED, 100000, 1, { category: "Flower", name: "Excluded fixture" })], { discount: 20000 });
  const quote = await f.quote(mixed);
  assert.equal(quote.eligibleMerchandiseCents, 90000, "Only merchandise receives its proportionate net amount.");
  const redeemed = await f.confirm(mixed, member, 1000);
  assert.equal(redeemed.receipt.externalPaidCents, 89000);
  assert.equal(redeemed.receipt.redeemedCents, 1000);
  assert.equal(redeemed.rewards.balanceCents, 0);
  assert.equal(redeemed.rewards.eligiblePaidSpendCents, 189000);
  assert.equal(redeemed.rewards.totalEarnedCents, 1000);
  assert.equal(redeemed.rewards.totalRedeemedCents, 1000);
  const overdraw = await f.request(PAYMENTS, {
    cookie: f.adminCookie, method: "POST",
    body: { orderId: f.seed([f.line(JAR, 10000)]), membershipNumber: member.member.membershipNumber,
      confirmedPaid: true, expectedEligibleMerchandiseCents: 10000, redeemCents: 1 },
  });
  assert.equal(overdraw.status, 422);
  const excludedOrder = f.seed([f.line(EXCLUDED, 100000, 1, { category: "Flower" })]);
  assert.equal((await f.request("/api/admin/rewards/quote?orderId=" + excludedOrder, { cookie: f.adminCookie })).status, 409);
  const unprocessed = f.seed([f.line()], { status: "pending" });
  assert.equal((await f.request("/api/admin/rewards/quote?orderId=" + unprocessed, { cookie: f.adminCookie })).status, 409);
});

test("logout during a slow merchandise payment body cannot confirm or issue credit", async (t) => {
  const f = await fixture(t);
  const member = await f.signup();
  const orderId = f.seed([f.line()]);
  const bytes = JSON.stringify({
    orderId, membershipNumber: member.member.membershipNumber,
    confirmedPaid: true, expectedEligibleMerchandiseCents: 100000, redeemCents: 0,
  });
  let finish;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bytes.slice(0, 15)));
      finish = () => { controller.enqueue(new TextEncoder().encode(bytes.slice(15))); controller.close(); };
    },
  });
  const pending = fetch(f.base + PAYMENTS, {
    method: "POST", duplex: "half", body,
    headers: { Cookie: f.adminCookie, "Content-Type": "application/json" },
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const logout = await f.request("/api/admin/logout", { cookie: f.adminCookie, method: "POST", body: {} });
  assert.equal(logout.status, 200);
  finish();
  assert.equal((await pending).status, 401);
  assert.equal((await f.own(member)).balanceCents, 0);
});
