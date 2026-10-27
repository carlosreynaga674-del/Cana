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

// Synthetic local accounts and ordinary merchandise only. No live host,
// real identity image, controlled product, payment or external email is used.
const PATH = "/api/members/addresses";
const PASSWORD = "Local private address-book member password 42";
const ADMIN = "Local private address-book administrator password 84";
const STAFF = "Local private address-book employee password 96";
const TOTE = "local-address-fixture-tote";
const home = (overrides = {}) => ({
  label: "Home", address: "10 Synthetic Test Lane", city: "Local Fixture City",
  postcode: "0001", ...overrides,
});

async function fixture(t, { ordering = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cana-member-address-http-"));
  const dbPath = join(directory, "fixture.sqlite");
  let server, base;
  const config = {
    businessName: "Local ordinary merchandise address fixture",
    businessJurisdiction: "Synthetic local fixture only",
    storeLicenseNumber: "LOCAL-FIXTURE-NOT-A-LICENSE",
    pickupAddress: "Local fixture pickup", contactEmail: "fixture@example.test",
    deliveryZips: ["0001", "0002", "0003", "0004"],
    liveOrdersEnabled: ordering, catalogApproved: ordering,
    legalSalesAuthorizationConfirmed: ordering, production: false,
  };
  async function start() {
    server = createServer({ dbPath, config, adminPassword: ADMIN, staffPassword: STAFF, mailConfig: {} });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = "http://127.0.0.1:" + server.address().port;
  }
  await start();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; DELETE FROM catalog_products;");
  // Keep this fixture's entire available catalog ordinary, synthetic merchandise.
  const product = { id: TOTE, name: "Local Linen Tote", category: "Accessories",
    price: 12500, size: "One bag", visual: "accessory", description: "Synthetic ordinary merchandise fixture." };
  const stamp = new Date().toISOString();
  db.prepare("INSERT INTO catalog_products (id,product_json,status,revision,created_at,updated_at) VALUES (?,?,'published',1,?,?)")
    .run(TOTE, JSON.stringify(product), stamp, stamp);
  t.after(async () => {
    db.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, { body, cookie, headers, ...options } = {}) => fetch(base + path, {
    ...options, headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}), ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function json(path, options, status = 200) {
    const response = await request(path, options);
    assert.equal(response.status, status, await response.clone().text());
    assert.match(response.headers.get("cache-control"), /no-store/);
    return response.json();
  }
  async function signup({ verified = false } = {}) {
    const email = randomUUID() + "@example.test";
    const prepared = await prepareSignup(request, {
      name: "Local Address Member", email, password: PASSWORD,
      ageConfirmed: true, termsAccepted: true, identityConsent: true,
    });
    const response = await request("/api/members/signup", { method: "POST", ...prepared });
    assert.equal(response.status, 201, await response.clone().text());
    const member = (await response.json()).member;
    if (verified) {
      // This isolated fixture seeds the retained legacy approval state. It does
      // not review or upload anybody's real identity evidence.
      db.prepare("UPDATE member_age_checks SET status='verified',birth_date=NULL,verified_at=?,method='in_person',identity_required=0 WHERE member_id=?")
        .run(new Date().toISOString(), member.id);
    }
    return { cookie: cookieValue(response, "lc_member"), member };
  }
  async function workforce(identifier, password) {
    const response = await request("/api/auth/login", { method: "POST", body: { identifier, password } });
    assert.equal(response.status, 200, await response.clone().text());
    return cookieValue(response, "lc_staff");
  }
  const list = async (member) => json(PATH, { cookie: member.cookie });
  const create = async (member, body = home()) => (await json(PATH, { cookie: member.cookie, method: "POST", body }, 201)).address;
  const update = async (member, address, body = {}) => (await json(PATH + "/" + address.id, {
    cookie: member.cookie, method: "PATCH", body: {
      label: address.label, address: address.address, city: address.city, postcode: address.postcode,
      expectedRevision: address.revision, ...body,
    },
  })).address;
  const orderBody = (address = home(), overrides = {}) => ({
    items: [{ productId: TOTE, sizeIndex: 0, quantity: 1 }], fulfillment: "delivery",
    customer: { name: "Local Address Member", email: "order-fixture@example.test",
      phone: "+27 82 123 4567", address: address.address, city: address.city, postcode: address.postcode },
    notes: "Synthetic local fixture. No real shipment or payment.", promoCode: "", ageConfirmed: true,
    ...overrides,
  });
  const order = (member, body = orderBody(), key = randomUUID(), headers = {}) => request("/api/orders", {
    cookie: member.cookie, method: "POST", body, headers: { "Idempotency-Key": key, ...headers },
  });
  return {
    db, request, json, signup, workforce, list, create, update, orderBody, order,
    get server() { return server; }, get base() { return base; },
    async restart() {
      await new Promise((resolve) => server.close(resolve));
      await start();
    },
  };
}

test("address books are member-private, owner-scoped and protected against cross-site writes", async (t) => {
  const f = await fixture(t);
  const alice = await f.signup(), bob = await f.signup();
  const staff = await f.workforce("staff", STAFF), admin = await f.workforce("admin", ADMIN);
  for (const cookie of [undefined, staff, admin]) {
    assert.equal((await f.request(PATH, { cookie })).status, 401);
    assert.equal((await f.request(PATH, { cookie, method: "POST", body: home() })).status, 401);
  }
  assert.deepEqual(await f.list(alice), { addresses: [], limit: 3, memberId: alice.member.id });
  const address = await f.create(alice);
  assert.deepEqual((await f.list(bob)).addresses, []);
  for (const method of ["PATCH", "DELETE"]) {
    const body = method === "PATCH" ? { ...home(), expectedRevision: address.revision } : { expectedRevision: address.revision };
    assert.equal((await f.request(PATH + "/" + address.id, { cookie: bob.cookie, method, body })).status, 404);
    assert.equal((await f.request(PATH + "/" + address.id, {
      cookie: alice.cookie, method, body, headers: { Origin: "https://unrelated.example.test" },
    })).status, 403);
  }
  assert.equal((await f.request(PATH, { cookie: alice.cookie, method: "POST", body: home({ label: "Other", address: "20 Synthetic Road" }),
    headers: { Origin: "https://unrelated.example.test" } })).status, 403);
  for (const route of ["/api/config", "/api/products", "/api/members/me"]) {
    const response = await f.request(route, { cookie: alice.cookie });
    assert.equal(response.status, 200);
    assert.equal((await response.text()).includes(address.address), false, route);
  }
  const directory = await f.json("/api/admin/members", { cookie: admin });
  assert.equal(JSON.stringify(directory).includes(address.address), false);
  assert.equal((await f.list(alice)).addresses.length, 1);
});

test("a captured member header prevents address reads or writes after the browser switches accounts", async (t) => {
  const f = await fixture(t);
  const alice = await f.signup(), bob = await f.signup();
  const address = await f.create(bob);
  const staleHeader = { "X-Member-ID": alice.member.id };
  assert.equal((await f.request(PATH, { cookie: bob.cookie, headers: staleHeader })).status, 401);
  assert.equal((await f.request(PATH, { cookie: bob.cookie, method: "POST", body: home({ address: "20 Unintended Fixture Street" }), headers: staleHeader })).status, 401);
  assert.equal((await f.request(PATH + "/" + address.id, { cookie: bob.cookie, method: "PATCH",
    body: { ...home({ address: "30 Unintended Fixture Street" }), expectedRevision: address.revision }, headers: staleHeader })).status, 401);
  assert.equal((await f.request(PATH + "/" + address.id, { cookie: bob.cookie, method: "DELETE",
    body: { expectedRevision: address.revision }, headers: staleHeader })).status, 401);
  const current = await f.request(PATH, { cookie: bob.cookie, headers: { "X-Member-ID": bob.member.id } });
  assert.equal(current.status, 200);
  const saved = await current.json();
  assert.equal(saved.memberId, bob.member.id);
  assert.deepEqual(saved.addresses, [address]);
  assert.equal((await f.list(alice)).addresses.length, 0);
});

test("address CRUD enforces three slots, normalized duplicates, revisions and leading-zero postal codes", async (t) => {
  const f = await fixture(t);
  const member = await f.signup();
  for (const body of [
    home({ label: "" }), home({ address: "" }), home({ city: "" }),
    home({ postcode: 1 }), home({ postcode: "001" }), home({ postcode: "00A1" }),
    home({ label: "x".repeat(41) }), home({ address: "x".repeat(241) }),
    home({ city: "x".repeat(101) }), home({ address: "bad\u0000address" }),
    { ...home(), memberId: member.member.id },
  ]) assert.equal((await f.request(PATH, { cookie: member.cookie, method: "POST", body })).status, 422);
  const one = await f.create(member);
  assert.equal(one.postcode, "0001");
  assert.equal(one.revision, 1);
  assert.ok(one.id && one.createdAt && one.updatedAt);
  assert.equal(one.lastUsedAt, null);
  assert.equal((await f.request(PATH, { cookie: member.cookie, method: "POST",
    body: home({ label: "Duplicate", address: "  10   SYNTHETIC TEST lane  ", city: "LOCAL   FIXTURE CITY" }) })).status, 409);
  const two = await f.create(member, home({ label: "Work", address: "20 Synthetic Road", postcode: "0002" }));
  const three = await f.create(member, home({ label: "Family", address: "30 Synthetic Street", postcode: "0003" }));
  assert.equal((await f.request(PATH, { cookie: member.cookie, method: "POST", body: home({ address: "40 Synthetic Street", postcode: "0004" }) })).status, 409);
  const changed = await f.update(member, one, { label: "Updated home", address: "11 Synthetic Test Lane" });
  assert.equal(changed.revision, 2);
  assert.equal(changed.id, one.id);
  assert.equal(changed.postcode, "0001");
  assert.equal((await f.request(PATH + "/" + one.id, { cookie: member.cookie, method: "PATCH",
    body: { ...home(), expectedRevision: one.revision } })).status, 409);
  assert.equal((await f.request(PATH + "/" + one.id, { cookie: member.cookie, method: "DELETE",
    body: { expectedRevision: one.revision } })).status, 409);
  await f.json(PATH + "/" + two.id, { cookie: member.cookie, method: "DELETE", body: { expectedRevision: two.revision } });
  const four = await f.create(member, home({ label: "New", address: "40 Synthetic Street", postcode: "0004" }));
  const ids = (await f.list(member)).addresses.map((address) => address.id);
  assert.deepEqual(new Set(ids), new Set([changed.id, three.id, four.id]));
  assert.equal((await f.request(PATH + "/" + two.id, { cookie: member.cookie, method: "DELETE",
    body: { expectedRevision: two.revision } })).status, 404);
});

test("accepted ordinary-merchandise deliveries remember addresses once and never rewrite earlier order snapshots", async (t) => {
  const f = await fixture(t, { ordering: true });
  const member = await f.signup({ verified: true });
  const key = randomUUID(), body = f.orderBody();
  const first = await f.order(member, body, key);
  assert.equal(first.status, 201, await first.clone().text());
  const order = (await first.json()).order;
  let addresses = (await f.list(member)).addresses;
  assert.equal(addresses.length, 1);
  const original = addresses[0];
  assert.equal(original.address, home().address);
  assert.equal(original.postcode, "0001");
  assert.ok(original.lastUsedAt);
  const retry = await f.order(member, body, key);
  assert.equal(retry.status, 200, await retry.clone().text());
  assert.equal((await retry.json()).order.id, order.id);
  const switchedAccount = await f.order(member, body, key, { "X-Member-ID": randomUUID() });
  assert.equal(switchedAccount.status, 401, "A stale client member must not replay a merchandise order under another account context.");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM orders").get().count, 1);
  assert.equal((await f.list(member)).addresses.length, 1);
  const named = await f.update(member, original, { label: "My home" });
  const repeat = await f.order(member, f.orderBody(home({ address: "10 SYNTHETIC   TEST lane", city: "LOCAL FIXTURE CITY" })));
  assert.equal(repeat.status, 201, await repeat.clone().text());
  addresses = (await f.list(member)).addresses;
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].label, "My home");
  assert.equal(addresses[0].revision, named.revision, "Usage must not create a content-edit revision.");
  await f.update(member, addresses[0], { address: "11 Synthetic Test Lane" });
  const savedOrder = JSON.parse(f.db.prepare("SELECT customer_json FROM orders WHERE id=?").get(order.id).customer_json);
  assert.equal(savedOrder.address, home().address, "Editing the address book must not alter an earlier order.");
  const pickup = await f.order(member, f.orderBody(home({ address: "Unstored pickup address", city: "Other city", postcode: "0004" }), { fulfillment: "pickup" }));
  assert.equal(pickup.status, 201, await pickup.clone().text());
  assert.equal((await f.list(member)).addresses.length, 1, "Pickup must not remember a delivery address.");
});

test("a full address book rejects a fourth new merchandise delivery without evicting an address or inserting an order", async (t) => {
  const f = await fixture(t, { ordering: true });
  const member = await f.signup({ verified: true });
  const addresses = [];
  for (let index = 1; index <= 3; index += 1)
    addresses.push(await f.create(member, home({ label: "Saved " + index, address: index + " Synthetic Avenue", postcode: "000" + index })));
  const before = (await f.list(member)).addresses;
  const key = randomUUID(), body = f.orderBody(home({ address: "40 Synthetic Street", postcode: "0004" }));
  const full = await f.order(member, body, key);
  assert.equal(full.status, 409, await full.clone().text());
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM orders").get().count, 0);
  assert.deepEqual((await f.list(member)).addresses, before);
  const known = await f.order(member, f.orderBody(addresses[0]));
  assert.equal(known.status, 201, await known.clone().text());
  assert.equal((await f.list(member)).addresses.length, 3);
  await f.json(PATH + "/" + addresses[1].id, { cookie: member.cookie, method: "DELETE", body: { expectedRevision: addresses[1].revision } });
  const accepted = await f.order(member, body, key);
  assert.equal(accepted.status, 201, await accepted.clone().text());
  const after = (await f.list(member)).addresses;
  assert.equal(after.length, 3);
  assert.ok(after.some((address) => address.address === "40 Synthetic Street"));
  assert.ok(after.some((address) => address.id === addresses[0].id));
  assert.ok(after.some((address) => address.id === addresses[2].id));
});

test("delivery address saving and ordinary order insertion roll back together when either write fails", async (t) => {
  const f = await fixture(t, { ordering: true });
  const member = await f.signup({ verified: true });
  for (const table of ["orders", "member_addresses"]) {
    f.db.exec("CREATE TRIGGER fail_address_delivery BEFORE INSERT ON " + table + " BEGIN SELECT RAISE(ABORT,'private local persistence failure'); END;");
    const failed = await f.order(member);
    assert.equal(failed.status, 500);
    assert.equal((await failed.text()).includes("private local persistence failure"), false);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM orders").get().count, 0);
    assert.equal((await f.list(member)).addresses.length, 0);
    f.db.exec("DROP TRIGGER fail_address_delivery");
  }
  const saved = await f.order(member);
  assert.equal(saved.status, 201, await saved.clone().text());
  assert.equal((await f.list(member)).addresses.length, 1);
});

test("private addresses and sessions survive restart and account deletion removes only that member's saved addresses", async (t) => {
  const f = await fixture(t);
  const alice = await f.signup(), bob = await f.signup();
  const aliceAddress = await f.create(alice), bobAddress = await f.create(bob, home({ address: "20 Other Synthetic Road" }));
  await f.restart();
  assert.equal((await f.list(alice)).addresses[0].id, aliceAddress.id);
  assert.equal((await f.list(bob)).addresses[0].id, bobAddress.id);
  await f.json("/api/members/me", { cookie: alice.cookie, method: "DELETE", body: { password: PASSWORD } });
  assert.equal((await f.request(PATH, { cookie: alice.cookie })).status, 401);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM member_addresses WHERE member_id=?").get(alice.member.id).count, 0);
  assert.equal((await f.list(bob)).addresses[0].id, bobAddress.id);
});

for (const method of ["POST", "PATCH", "DELETE"]) {
  test("logout during an address " + method + " body prevents the stale mutation", async (t) => {
    const f = await fixture(t);
    const member = await f.signup(), original = await f.create(member);
    const path = method === "POST" ? PATH : PATH + "/" + original.id;
    const body = method === "DELETE" ? { expectedRevision: original.revision } : {
      ...home({ label: "Changed", address: "20 Changed Synthetic Road" }),
      ...(method === "PATCH" ? { expectedRevision: original.revision } : {}),
    };
    const encoded = JSON.stringify(body);
    let finish;
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(encoded.slice(0, 8)));
      finish = () => { controller.enqueue(new TextEncoder().encode(encoded.slice(8))); controller.close(); };
    } });
    const arriving = once(f.server, "request");
    const pending = fetch(f.base + path, { method, body: stream, duplex: "half",
      headers: { Cookie: member.cookie, "Content-Type": "application/json" } });
    await arriving;
    assert.equal((await f.request("/api/members/logout", { cookie: member.cookie, method: "POST" })).status, 200);
    finish();
    const denied = await pending;
    assert.equal(denied.status, 401, await denied.clone().text());
    const rows = f.db.prepare("SELECT id,label,address FROM member_addresses WHERE member_id=?").all(member.member.id);
    assert.deepEqual(rows.map((row) => ({ ...row })), [{ id: original.id, label: original.label, address: original.address }]);
  });
}
