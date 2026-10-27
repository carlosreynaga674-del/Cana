import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemberAddresses } from "../server/member-addresses.mjs";

// Private synthetic address fixtures only. No customer orders or remote calls.
class HttpError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}
const hasStatus = (status) => (error) => error instanceof HttpError && error.status === status;
const ADDRESS = { label: "Home", address: "1 Local Test Road", city: "Local Fixture City", postcode: "0001" };
const SAFE_FIELDS = ["id", "label", "address", "city", "postcode", "revision", "createdAt", "updatedAt", "lastUsedAt"].sort();

function schema(db) {
  db.exec(
    "PRAGMA foreign_keys=ON;" +
    "CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY);" +
    "CREATE TABLE IF NOT EXISTS catalog_products(id TEXT PRIMARY KEY,product_json TEXT NOT NULL,status TEXT NOT NULL);",
  );
}
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  schema(db);
  db.exec("INSERT INTO members VALUES ('member-a'),('member-b');");
  let clock = Date.parse("2026-10-26T12:00:00.000Z");
  const book = createMemberAddresses({ db, HttpError, now: () => clock });
  t.after(() => db.close());
  const product = (id, category = "Accessories") => db.prepare("INSERT INTO catalog_products VALUES (?,?,'published') ON CONFLICT(id) DO UPDATE SET product_json=excluded.product_json")
    .run(id, JSON.stringify({ id, name: "Local fixture merchandise", category }));
  product("local-tote"); product("local-jar"); product("excluded-fixture", "Flower");
  const delivery = (customer = ADDRESS, items = [{ id: "local-tote", productId: "local-tote", category: "Accessories" }]) =>
    ({ fulfillment: "delivery", customer: { address: customer.address, city: customer.city, postcode: customer.postcode }, items });
  return { db, book, product, delivery, advance: () => { clock += 1000; }, stamp: () => new Date(clock).toISOString() };
}

test("members can create, edit and remove only their own three safe address records", (t) => {
  const { book, advance } = fixture(t);
  assert.deepEqual(book.list("member-a"), { addresses: [], limit: 3 });
  const created = book.create("member-a", ADDRESS);
  assert.deepEqual(Object.keys(created).sort(), SAFE_FIELDS);
  assert.match(created.id, /^[a-f0-9-]{36}$/);
  assert.equal(created.postcode, "0001");
  assert.equal(created.revision, 1);
  assert.equal(created.lastUsedAt, null);
  assert.deepEqual(book.list("member-b").addresses, []);
  advance();
  const updated = book.update("member-a", created.id, { ...ADDRESS, label: "Work", address: "2 Local Test Road", expectedRevision: 1 });
  assert.equal(updated.id, created.id);
  assert.equal(updated.label, "Work");
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, created.createdAt);
  assert.notEqual(updated.updatedAt, created.updatedAt);
  assert.throws(() => book.update("member-a", created.id, { ...ADDRESS, expectedRevision: 1 }), hasStatus(409));
  assert.throws(() => book.remove("member-a", created.id, { expectedRevision: 1 }), hasStatus(409));
  assert.throws(() => book.update("member-b", created.id, { ...ADDRESS, expectedRevision: 2 }), hasStatus(404));
  assert.throws(() => book.remove("member-b", created.id, { expectedRevision: 2 }), hasStatus(404));
  assert.deepEqual(book.remove("member-a", created.id, { expectedRevision: 2 }), { ok: true });
  assert.deepEqual(book.list("member-a").addresses, []);
  assert.throws(() => book.remove("member-a", created.id, { expectedRevision: 2 }), hasStatus(404));
  for (const method of [
    () => book.list("missing"), () => book.create("missing", ADDRESS),
    () => book.update("missing", created.id, { ...ADDRESS, expectedRevision: 1 }),
    () => book.remove("missing", created.id, { expectedRevision: 1 }),
  ]) assert.throws(method, hasStatus(404));
});

test("invalid or forged address fields cannot be stored and postal zeros remain intact", (t) => {
  const { book } = fixture(t);
  for (const body of [
    null, [], {}, { ...ADDRESS, label: "" }, { ...ADDRESS, label: "x".repeat(41) },
    { ...ADDRESS, address: "" }, { ...ADDRESS, address: "x".repeat(241) },
    { ...ADDRESS, city: "" }, { ...ADDRESS, city: "x".repeat(101) },
    { ...ADDRESS, postcode: 1 }, { ...ADDRESS, postcode: "001" }, { ...ADDRESS, postcode: "00001" },
    { ...ADDRESS, label: "Hidden\nlabel" }, { ...ADDRESS, address: "Road\u0000" },
    { ...ADDRESS, city: "City\u007f" }, { ...ADDRESS, memberId: "member-b" },
    { ...ADDRESS, id: "caller-selected-id" }, { ...ADDRESS, lastUsedAt: "2026-01-01T00:00:00Z" },
  ]) assert.throws(() => book.create("member-a", body), hasStatus(422));
  assert.equal(book.list("member-a").addresses.length, 0);
  const row = book.create("member-a", { label: " Home ", address: " 1 Local Test Road ", city: " Local Fixture City ", postcode: " 0001 " });
  for (const [key, value] of Object.entries(ADDRESS)) assert.equal(row[key], value);
  for (const body of [
    { ...ADDRESS, expectedRevision: "1" }, { ...ADDRESS, expectedRevision: 0 },
    { ...ADDRESS, expectedRevision: 1, role: "admin" },
  ]) assert.throws(() => book.update("member-a", row.id, body), hasStatus(422));
  assert.throws(() => book.remove("member-a", row.id, { expectedRevision: "1" }), hasStatus(422));
  assert.throws(() => book.remove("member-a", row.id, { expectedRevision: 1, memberId: "member-b" }), hasStatus(422));
});

test("the three-address cap and normalized duplicate checks never evict or merge another saved address", (t) => {
  const { book } = fixture(t);
  const first = book.create("member-a", { ...ADDRESS, address: "1 Local  Test Road" });
  assert.throws(() => book.create("member-a", { ...ADDRESS, label: "Different label", address: " １ local test road ", city: "LOCAL FIXTURE CITY" }), hasStatus(409));
  const second = book.create("member-a", { ...ADDRESS, label: "Work", address: "2 Local Test Road" });
  book.create("member-a", { ...ADDRESS, label: "Other", address: "3 Local Test Road" });
  const before = book.list("member-a");
  assert.throws(() => book.create("member-a", { ...ADDRESS, address: "4 Local Test Road" }), hasStatus(409));
  assert.deepEqual(book.list("member-a"), before);
  assert.throws(() => book.update("member-a", second.id, { ...ADDRESS, address: first.address, expectedRevision: 1 }), hasStatus(409));
  assert.deepEqual(book.list("member-a"), before);
  const other = book.create("member-b", ADDRESS);
  assert.notEqual(other.id, first.id, "The same physical address may belong to independent members.");
});

test("ordinary delivery remembers a new address and reuses matching addresses without overwriting labels or revisions", (t) => {
  const { book, delivery, advance, stamp } = fixture(t);
  const home = book.create("member-a", ADDRESS);
  advance();
  const work = book.create("member-a", { ...ADDRESS, label: "Work", address: "2 Local Test Road" });
  assert.equal(book.list("member-a").addresses[0].id, work.id);
  advance();
  const remembered = book.rememberDelivery("member-a", delivery({ ...ADDRESS, address: "１ LOCAL   TEST ROAD", city: "local fixture city" }));
  assert.deepEqual(remembered, { saved: true, addressId: home.id });
  const latest = book.list("member-a").addresses[0];
  assert.equal(latest.id, home.id);
  assert.equal(latest.label, "Home");
  assert.equal(latest.address, ADDRESS.address);
  assert.equal(latest.revision, home.revision);
  assert.equal(latest.updatedAt, home.updatedAt);
  assert.equal(latest.lastUsedAt, stamp());
  advance();
  const added = book.rememberDelivery("member-a", delivery({ ...ADDRESS, address: "3 Local Test Road" }));
  const saved = book.list("member-a").addresses.find((row) => row.id === added.addressId);
  assert.equal(saved.address, "3 Local Test Road");
  assert.match(saved.label, /^Delivery address/);
  assert.equal(saved.lastUsedAt, stamp());
  assert.deepEqual(book.list("member-a"), book.list("member-a"), "Tied sort keys must remain deterministic.");
  const before = book.list("member-a");
  assert.throws(() => book.rememberDelivery("member-a", delivery({ ...ADDRESS, address: "4 Local Test Road" })), hasStatus(409));
  assert.deepEqual(book.list("member-a"), before);
});

test("automatic remembering excludes pickup, mixed items and current/historical category mismatches", (t) => {
  const { book, db, delivery } = fixture(t);
  for (const candidate of [
    { ...delivery(), fulfillment: "pickup" }, { ...delivery(), items: [] },
    delivery(ADDRESS, [{ id: "excluded-fixture", productId: "excluded-fixture", category: "Flower" }]),
    delivery(ADDRESS, [{ id: "excluded-fixture", productId: "excluded-fixture", category: "Accessories" }]),
    delivery(ADDRESS, [{ id: "local-tote", productId: "local-tote", category: "Flower" }]),
    delivery(ADDRESS, [{ id: "local-tote", productId: "local-tote", category: "Accessories" }, { id: "excluded-fixture", productId: "excluded-fixture", category: "Flower" }]),
    delivery(ADDRESS, [{ id: "missing-product", productId: "missing-product", category: "Accessories" }]),
    delivery(ADDRESS, [{ id: "local-tote", productId: "local-jar", category: "Accessories" }]),
  ]) assert.deepEqual(book.rememberDelivery("member-a", candidate), { saved: false });
  assert.deepEqual(book.list("member-a").addresses, []);
  db.prepare("UPDATE catalog_products SET product_json='{' WHERE id='local-tote'").run();
  assert.deepEqual(book.rememberDelivery("member-a", delivery()), { saved: false });
  assert.deepEqual(book.list("member-a").addresses, []);
});

test("address changes participate in the caller transaction and failed saves leave no open transaction", (t) => {
  const { book, db, delivery } = fixture(t);
  db.exec("CREATE TABLE caller_marker (id INTEGER); BEGIN IMMEDIATE; INSERT INTO caller_marker VALUES (1);");
  book.create("member-a", ADDRESS);
  book.rememberDelivery("member-a", delivery({ ...ADDRESS, address: "2 Local Test Road" }));
  assert.equal(db.isTransaction, true, "The address store must not commit its caller transaction.");
  assert.equal(book.list("member-a").addresses.length, 2);
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT count(*) AS n FROM caller_marker").get().n, 0);
  assert.deepEqual(book.list("member-a").addresses, []);
  db.exec("CREATE TRIGGER fail_address_insert BEFORE INSERT ON member_addresses BEGIN SELECT RAISE(ABORT,'synthetic address failure'); END;");
  assert.throws(() => book.create("member-a", ADDRESS), /synthetic address failure/);
  assert.equal(db.isTransaction, false);
  assert.deepEqual(book.list("member-a").addresses, []);
  db.exec("DROP TRIGGER fail_address_insert");
  assert.equal(book.create("member-a", ADDRESS).revision, 1);
});

test("saved addresses survive restart and account deletion removes them through foreign keys", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-address-book-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "fixture.sqlite");
  let db = new DatabaseSync(filename);
  schema(db);
  db.exec("INSERT INTO members VALUES ('member-a'),('member-b');");
  let book = createMemberAddresses({ db, HttpError });
  const row = book.create("member-a", ADDRESS);
  db.close();
  db = new DatabaseSync(filename);
  schema(db);
  t.after(() => db.close());
  book = createMemberAddresses({ db, HttpError });
  assert.deepEqual(book.list("member-a").addresses, [row]);
  db.prepare("DELETE FROM members WHERE id=?").run("member-a");
  assert.equal(db.prepare("SELECT count(*) AS n FROM member_addresses").get().n, 0);
  assert.throws(() => book.list("member-a"), hasStatus(404));
  assert.throws(() => book.update("member-b", row.id, { ...ADDRESS, expectedRevision: 1 }), hasStatus(404));
});
