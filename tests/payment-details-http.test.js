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

// Synthetic operator records only: no bank connection, customer transaction,
// external email or production data is used by this fixture.
const ENDPOINT = "/api/admin/merchandise-payment-details";
const ADMIN = "Local private payment settings administrator password 42";
const STAFF = "Local private payment settings employee password 84";
const DETAILS = {
  bankName: "Synthetic Fixture Bank", accountHolder: "Local Merchandise Fixture",
  accountNumber: "001234567890", branchCode: "001234", accountType: "business",
  reference: "Local membership reference", instructions: "Private fixture record; no payment is requested.",
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "cana-private-payment-settings-"));
  const dbPath = join(directory, "fixture.sqlite");
  let server, base, closed = false;
  async function start() {
    server = createServer({ dbPath, adminPassword: ADMIN, staffPassword: STAFF,
      config: { businessName: "Local private merchandise fixture", liveOrdersEnabled: false }, mailConfig: {} });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = "http://127.0.0.1:" + server.address().port;
  }
  await start();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  t.after(async () => {
    db.close();
    if (!closed) await new Promise((resolve) => server.close(resolve));
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
  let admin = await login("admin", ADMIN);
  const staff = await login("staff", STAFF);
  async function get() {
    const response = await request(ENDPOINT, { cookie: admin });
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get("cache-control"), /no-store/);
    return response.json();
  }
  async function save(details = DETAILS, expectedRevision) {
    if (expectedRevision === undefined) expectedRevision = (await get()).revision;
    return request(ENDPOINT, { cookie: admin, method: "PUT", body: { details, expectedRevision } });
  }
  async function signup() {
    const prepared = await prepareSignup(request, {
      name: "Local settings privacy member", email: randomUUID() + "@example.test",
      password: "Local payment settings member password 96", ageConfirmed: true,
      termsAccepted: true, identityConsent: true,
    });
    const response = await request("/api/members/signup", { method: "POST", ...prepared });
    assert.equal(response.status, 201, await response.clone().text());
    return cookieValue(response, "lc_member");
  }
  return { request, get, save, signup, db, staff,
    get admin() { return admin; }, get base() { return base; }, get server() { return server; },
    async restart() {
      await new Promise((resolve) => server.close(resolve));
      closed = true;
      await start();
      closed = false;
      admin = await login("admin", ADMIN);
    },
  };
}

test("private merchandise payment details require administrator access and remain absent from public/member data", async (t) => {
  const f = await fixture(t);
  const member = await f.signup();
  for (const [cookie, status] of [[undefined, 401], [member, 401], [f.staff, 403]]) {
    assert.equal((await f.request(ENDPOINT, { cookie })).status, status);
    assert.equal((await f.request(ENDPOINT, { cookie, method: "PUT", body: { details: DETAILS, expectedRevision: 1 } })).status, status);
  }
  assert.equal((await f.request(ENDPOINT, { cookie: f.admin, method: "PUT",
    body: { details: DETAILS, expectedRevision: 1 }, headers: { Origin: "https://unrelated.example.test" } })).status, 403);
  const initial = await f.get();
  assert.equal(initial.scope, "non_cannabis_merchandise");
  assert.equal(initial.configured, false);
  assert.equal(initial.updatedAt, null);
  assert.equal(initial.revision, 1);
  assert.deepEqual(initial.details, { bankName: "", accountHolder: "", accountNumber: "", branchCode: "", accountType: "current", reference: "", instructions: "" });
  assert.equal((await f.save()).status, 200);
  for (const path of ["/api/config", "/api/products", "/api/members/me"]) {
    const response = await f.request(path, { cookie: member });
    assert.equal(response.status, 200, path);
    const text = await response.text();
    for (const value of [DETAILS.bankName, DETAILS.accountHolder, DETAILS.accountNumber, DETAILS.branchCode, DETAILS.reference])
      assert.equal(text.includes(value), false, path + " must not expose " + value);
  }
});

test("administrator payment updates preserve numeric strings, reject forged fields and stale revisions, and survive restart", async (t) => {
  const f = await fixture(t);
  for (const details of [
    { ...DETAILS, accountNumber: 1234567890 }, { ...DETAILS, accountNumber: "12ABC567" },
    { ...DETAILS, branchCode: "12345" }, { ...DETAILS, bankName: "X" },
    { ...DETAILS, accountHolder: "A" }, { ...DETAILS, accountType: "admin" },
    { ...DETAILS, reference: "x".repeat(81) }, { ...DETAILS, instructions: "x".repeat(1001) },
    { ...DETAILS, password: "not a supported field" },
  ]) assert.equal((await f.save(details, 1)).status, 422);
  const forged = await f.request(ENDPOINT, { cookie: f.admin, method: "PUT",
    body: { details: DETAILS, expectedRevision: 1, scope: "all_orders" } });
  assert.equal(forged.status, 422);
  assert.equal((await f.get()).revision, 1);
  const savedResponse = await f.save(DETAILS, 1);
  assert.equal(savedResponse.status, 200, await savedResponse.clone().text());
  const saved = await savedResponse.json();
  assert.deepEqual(saved.details, DETAILS);
  assert.equal(saved.configured, true);
  assert.equal(saved.revision, 2);
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
  assert.equal((await f.save({ ...DETAILS, bankName: "Stale caller must not replace this" }, 1)).status, 409);
  assert.deepEqual((await f.get()).details, DETAILS);
  const changed = { ...DETAILS, accountNumber: "000000987654", branchCode: "000321", reference: "Revised fixture reference" };
  assert.equal((await f.save(changed, saved.revision)).status, 200);
  const audit = JSON.stringify(f.db.prepare("SELECT * FROM merchandise_payment_audit ORDER BY revision").all());
  for (const value of [DETAILS.bankName, DETAILS.accountHolder, DETAILS.accountNumber, changed.accountNumber, ADMIN])
    assert.equal(audit.includes(value), false, "Audit must not duplicate confidential settings.");
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM merchandise_payment_audit").get().count, 2);
  await f.restart();
  const restored = await f.get();
  assert.deepEqual(restored.details, changed);
  assert.equal(restored.revision, 3);
});

test("logout while a private payment-settings body arrives prevents the update", async (t) => {
  const f = await fixture(t);
  const bytes = JSON.stringify({ details: DETAILS, expectedRevision: 1 });
  let finish;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(bytes.slice(0, 15)));
    finish = () => { controller.enqueue(new TextEncoder().encode(bytes.slice(15))); controller.close(); };
  } });
  const arriving = once(f.server, "request");
  const pending = fetch(f.base + ENDPOINT, { method: "PUT", duplex: "half", body: stream,
    headers: { Cookie: f.admin, "Content-Type": "application/json" } });
  await arriving;
  assert.equal((await f.request("/api/admin/logout", { cookie: f.admin, method: "POST", body: {} })).status, 200);
  finish();
  assert.equal((await pending).status, 401);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM merchandise_payment_audit").get().count, 0);
  await f.restart();
  assert.equal((await f.get()).configured, false);
});

test("private payment settings and their audit record roll back together on persistence failure", async (t) => {
  const f = await fixture(t);
  f.db.exec("CREATE TRIGGER fail_private_payment_audit BEFORE INSERT ON merchandise_payment_audit BEGIN SELECT RAISE(ABORT,'private fixture audit failure'); END;");
  const rejected = await f.save(DETAILS, 1);
  assert.equal(rejected.status, 500);
  const error = await rejected.text();
  assert.equal(error.includes("private fixture audit failure"), false);
  assert.equal(error.includes(DETAILS.accountNumber), false);
  const unchanged = await f.get();
  assert.equal(unchanged.configured, false);
  assert.equal(unchanged.revision, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM merchandise_payment_audit").get().count, 0);
  f.db.exec("DROP TRIGGER fail_private_payment_audit");
  assert.equal((await f.save(DETAILS, 1)).status, 200);
  assert.deepEqual((await f.get()).details, DETAILS);
});
