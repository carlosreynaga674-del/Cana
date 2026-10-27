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

// Read-only checkout instructions with synthetic bank records and merchandise.
// The fixture never enables live intake, submits an order or connects a bank.
const PATH = "/api/members/merchandise-payment-details";
const ADMIN_PATH = "/api/admin/merchandise-payment-details";
const ADMIN = "Local checkout instructions administrator password 42";
const STAFF = "Local checkout instructions employee password 84";
const PASSWORD = "Local checkout instructions member password 96";
const TOTE = "local-payment-fixture-tote";
const OTHER = "local-payment-fixture-other";
const DETAILS = {
  bankName: "Synthetic Checkout Fixture Bank", accountHolder: "Local Merchandise Fixture",
  accountNumber: "001234567890", branchCode: "001234", accountType: "business",
  reference: "Synthetic merchandise reference", instructions: "Private operator note must never be shown to members.",
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "cana-checkout-bank-details-"));
  const dbPath = join(directory, "fixture.sqlite");
  const server = createServer({ dbPath, adminPassword: ADMIN, staffPassword: STAFF,
    config: { businessName: "Local checkout instructions fixture", liveOrdersEnabled: false }, mailConfig: {} });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; DELETE FROM catalog_products;");
  const insert = db.prepare("INSERT INTO catalog_products (id,product_json,status,revision,created_at,updated_at) VALUES (?,?,'published',1,?,?)");
  const stamp = new Date().toISOString();
  for (const [id, category] of [[TOTE, "Accessories"], [OTHER, "Drinks"]]) {
    insert.run(id, JSON.stringify({ id, name: "Synthetic ordinary fixture " + id,
      category, price: 12500, size: "Standard", description: "Synthetic local fixture only." }), stamp, stamp);
  }
  t.after(async () => {
    db.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, { body, cookie, headers, ...options } = {}) => fetch(base + path, {
    ...options, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function login(identifier, password) {
    const response = await request("/api/auth/login", { method: "POST", body: { identifier, password } });
    assert.equal(response.status, 200, await response.clone().text());
    return cookieValue(response, "lc_staff");
  }
  const admin = await login("admin", ADMIN), staff = await login("staff", STAFF);
  async function member(verified = false) {
    const prepared = await prepareSignup(request, { name: "Local Checkout Member", email: randomUUID() + "@example.test",
      password: PASSWORD, ageConfirmed: true, termsAccepted: true, identityConsent: true });
    const response = await request("/api/members/signup", { method: "POST", ...prepared });
    assert.equal(response.status, 201, await response.clone().text());
    const account = (await response.json()).member;
    if (verified) db.prepare("UPDATE member_age_checks SET status='verified',birth_date=NULL,verified_at=?,method='in_person',identity_required=0 WHERE member_id=?")
      .run(stamp, account.id);
    return { member: account, cookie: cookieValue(response, "lc_member") };
  }
  async function save(details = DETAILS) {
    const current = await request(ADMIN_PATH, { cookie: admin });
    assert.equal(current.status, 200);
    const response = await request(ADMIN_PATH, { cookie: admin, method: "PUT",
      body: { details, expectedRevision: (await current.json()).revision } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  const checkout = (account, body = { productIds: [TOTE] }, extra = {}) => request(PATH, {
    method: "POST", cookie: account?.cookie, body,
    headers: account ? { "X-Member-ID": account.member.id } : undefined, ...extra,
  });
  return { request, member, save, checkout, db, server, base, admin, staff };
}

test("merchandise checkout bank details require a verified member, owner binding and same-origin access", async (t) => {
  const f = await fixture(t);
  await f.save();
  const pending = await f.member(), verified = await f.member(true), other = await f.member(true);
  for (const cookie of [undefined, f.admin, f.staff]) {
    const denied = await f.request(PATH, { cookie, method: "POST", body: { productIds: [TOTE] } });
    assert.equal(denied.status, 401);
    assert.equal((await denied.text()).includes(DETAILS.accountNumber), false);
  }
  assert.equal((await f.checkout(pending)).status, 403);
  assert.equal((await f.checkout(verified, undefined, { headers: { "X-Member-ID": other.member.id } })).status, 401);
  assert.equal((await f.checkout(verified, undefined, { headers: { "X-Member-ID": verified.member.id, Origin: "https://unrelated.example.test" } })).status, 403);
  const allowed = await f.checkout(verified);
  assert.equal(allowed.status, 200, await allowed.clone().text());
  assert.match(allowed.headers.get("cache-control"), /no-store/);
  assert.equal((await allowed.json()).memberId, verified.member.id);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 0);
});

test("eligible checkout instructions expose only six approved bank fields and preserve leading zeros", async (t) => {
  const f = await fixture(t), account = await f.member(true);
  const missing = await f.checkout(account);
  assert.equal(missing.status, 200, await missing.clone().text());
  const unconfigured = await missing.json();
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.details, null);
  const saved = await f.save();
  const response = await f.checkout(account);
  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json();
  assert.equal(data.memberId, account.member.id);
  assert.equal(data.scope, "non_cannabis_merchandise");
  assert.equal(data.configured, true);
  assert.equal(data.revision, saved.revision);
  assert.equal(data.updatedAt, saved.updatedAt);
  const { instructions, ...shared } = DETAILS;
  assert.deepEqual(data.details, shared);
  assert.equal(JSON.stringify(data).includes(instructions), false);
  const privateResponse = await f.request(ADMIN_PATH, { cookie: f.admin });
  assert.equal((await privateResponse.json()).details.instructions, instructions);
  for (const path of ["/api/config", "/api/products", "/api/members/me"]) {
    const publicResponse = await f.request(path, { cookie: account.cookie });
    const text = await publicResponse.text();
    assert.equal(text.includes(DETAILS.accountNumber), false, path);
    assert.equal(text.includes(instructions), false, path);
  }
  await f.save({ ...DETAILS, reference: "" });
  const referenceResponse = await f.checkout(account);
  assert.equal(referenceResponse.status, 200);
  assert.equal((await referenceResponse.json()).details.reference, account.member.membershipNumber,
    "An empty administrator reference uses the authenticated member's own membership number.");
});

test("checkout instruction eligibility uses published server catalog categories and rejects forged selection bodies", async (t) => {
  const f = await fixture(t), account = await f.member(true);
  await f.save();
  for (const body of [
    {}, { productIds: [] }, { productIds: [TOTE, TOTE] }, { productIds: [TOTE], category: "Accessories" },
    { productIds: [TOTE], instructions: "Caller cannot choose instructions" }, { productIds: [1] },
  ]) {
    const denied = await f.checkout(account, body);
    assert.equal(denied.status, 422, await denied.clone().text());
    assert.equal((await denied.text()).includes(DETAILS.accountNumber), false);
  }
  for (const productIds of [[OTHER], [TOTE, OTHER], ["missing-fixture-product"]]) {
    const denied = await f.checkout(account, { productIds });
    assert.equal(denied.status, 409, await denied.clone().text());
    assert.equal((await denied.text()).includes(DETAILS.accountNumber), false);
  }
  f.db.prepare("UPDATE catalog_products SET status='draft' WHERE id=?").run(TOTE);
  assert.equal((await f.checkout(account)).status, 409);
  f.db.prepare("UPDATE catalog_products SET status='published',product_json=json_set(product_json,'$.category','Drinks') WHERE id=?").run(TOTE);
  assert.equal((await f.checkout(account)).status, 409);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 0);
});

test("logout while an instruction request body arrives prevents disclosure of bank details", async (t) => {
  const f = await fixture(t), account = await f.member(true);
  await f.save();
  const encoded = JSON.stringify({ productIds: [TOTE] });
  let finish;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(encoded.slice(0, 8)));
    finish = () => { controller.enqueue(new TextEncoder().encode(encoded.slice(8))); controller.close(); };
  } });
  const arriving = once(f.server, "request");
  const pending = fetch(f.base + PATH, { method: "POST", body: stream, duplex: "half",
    headers: { Cookie: account.cookie, "Content-Type": "application/json", "X-Member-ID": account.member.id } });
  await arriving;
  assert.equal((await f.request("/api/members/logout", { cookie: account.cookie, method: "POST" })).status, 200);
  finish();
  const denied = await pending;
  assert.equal(denied.status, 401, await denied.clone().text());
  assert.equal((await denied.text()).includes(DETAILS.accountNumber), false);
});
