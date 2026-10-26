import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProcessedReports } from "../server/processed-reports.mjs";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const actor = { id: "synthetic-staff-id", name: "Local Reviewer", username: "local.reviewer", role: "staff" };
const options = { from: "2026-10-01", to: "2026-10-31" };
const statusError = (status) => (error) => error instanceof HttpError && error.status === status;

function database(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON;" +
    "CREATE TABLE IF NOT EXISTS catalog_products (id TEXT PRIMARY KEY,product_json TEXT NOT NULL,status TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY,status TEXT NOT NULL,updated_at TEXT NOT NULL,items_json TEXT NOT NULL," +
      "customer_json TEXT,totals_json TEXT,notes TEXT);",
  );
  return db;
}
function product(db, id, category = "Accessories", status = "published", name = id + " merchandise") {
  db.prepare("INSERT INTO catalog_products (id,product_json,status) VALUES (?,?,?)").run(id, JSON.stringify({ id, name, category }), status);
}
function line(id, quantity = 1, extra = {}) {
  return { id, productId: id, name: id + " merchandise", category: "Accessories", size: "Standard", quantity, ...extra };
}
function order(db, id, items, extra = {}) {
  db.prepare("INSERT INTO orders (id,status,updated_at,items_json,customer_json,totals_json,notes) VALUES (?,?,?,?,?,?,?)")
    .run(id, extra.status || "completed", extra.updated_at || "2026-10-25T10:00:00.000Z",
      JSON.stringify(items), '{"name":"Private Customer","email":"customer@example.test"}', '{"total":999999}', "Private customer note");
  return db.prepare("SELECT * FROM orders WHERE id=?").get(id);
}
function setup(t, filename) {
  const db = database(filename);
  t.after(() => db.close());
  const reports = createProcessedReports({ db, HttpError, now: () => NOW });
  const choose = (ids) => reports.saveSettings({ productIds: ids, expectedRevision: reports.settings().revision });
  return { db, reports, choose };
}

test("report product preferences include only merchandise, validate revisions and persist across restart", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-report-preferences-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "local.sqlite");
  let db = database(filename);
  product(db, "glass-jar");
  product(db, "old-tote", "Accessories", "archived");
  product(db, "future-cap", "Accessories", "draft");
  for (const category of ["Flower", "Pre-rolls", "Edibles", "Vapes", "Drinks"])
    product(db, "excluded-" + category.toLowerCase().replaceAll(" ", "-"), category);
  db.prepare("INSERT INTO catalog_products VALUES (?,?,?)").run("invalid-record", "{", "published");
  let reports = createProcessedReports({ db, HttpError, now: () => NOW });
  assert.equal(reports.settings().scope, "non_cannabis_merchandise");
  assert.deepEqual(reports.settings().products.map((item) => item.id).sort(), ["future-cap", "glass-jar", "old-tote"]);
  assert.deepEqual(reports.settings().selectedProductIds, []);
  const saved = reports.saveSettings({ productIds: ["glass-jar", "old-tote"], expectedRevision: 1 });
  assert.equal(saved.revision, 2);
  assert.throws(() => reports.saveSettings({ productIds: ["future-cap"], expectedRevision: 1 }), statusError(409));
  for (const body of [
    null, [], {}, { productIds: ["glass-jar", "glass-jar"], expectedRevision: 2 },
    { productIds: ["excluded-flower"], expectedRevision: 2 },
    { productIds: ["missing-product"], expectedRevision: 2 },
    { productIds: ["glass-jar"], expectedRevision: "2" },
    { productIds: ["glass-jar"], expectedRevision: 2, role: "admin" },
    { productIds: Array.from({ length: 101 }, (_, index) => "over-limit-" + index), expectedRevision: 2 },
  ]) assert.throws(() => reports.saveSettings(body), statusError(422));
  db.close();
  db = database(filename);
  t.after(() => db.close());
  reports = createProcessedReports({ db, HttpError, now: () => NOW });
  assert.deepEqual(reports.settings().selectedProductIds, ["glass-jar", "old-tote"]);
  assert.equal(reports.settings().revision, 2);
  assert.deepEqual(reports.saveSettings({ productIds: [], expectedRevision: 2 }).selectedProductIds, []);
});

test("mixed processed records return only selected merchandise without customer or restricted-product data", (t) => {
  const { db, reports, choose } = setup(t);
  product(db, "glass-jar");
  product(db, "canvas-tote");
  product(db, "excluded-flower", "Flower");
  choose(["glass-jar"]);
  const mixed = order(db, "LOCAL-MIXED", [
    line("glass-jar", 2), line("canvas-tote", 4),
    line("excluded-flower", 8, { category: "Flower", name: "Restricted line name" }),
  ]);
  reports.recordCompletion(mixed, actor);
  order(db, "LOCAL-UNSELECTED", [line("canvas-tote")]);
  order(db, "LOCAL-NOT-COMPLETED", [line("glass-jar")], { status: "pending" });
  order(db, "LOCAL-RESTRICTED", [line("excluded-flower", 1, { category: "Flower" })]);
  const data = reports.list(options);
  assert.equal(data.total, 1);
  assert.deepEqual(data.summary, { records: 1, units: 2 });
  assert.deepEqual(data.groups[0].records[0].products, [{ id: "glass-jar", name: "glass-jar merchandise", size: "Standard", quantity: 2 }]);
  const payload = JSON.stringify(data);
  for (const privateValue of ["Private Customer", "customer@example.test", "Private customer note", "999999", "Restricted line name", "excluded-flower", "canvas-tote"])
    assert.equal(payload.includes(privateValue), false, privateValue);
  const stored = JSON.stringify(db.prepare("SELECT * FROM processed_merchandise_events").all());
  assert.equal(stored.includes("Restricted line name"), false);
  assert.equal(stored.includes("excluded-flower"), false);
  assert.equal(stored.includes("Private Customer"), false);
  assert.equal(stored.includes(actor.id), false);
});

test("staff attribution snapshots are immutable and shared accounts are identified honestly", (t) => {
  const { db, reports, choose } = setup(t);
  product(db, "glass-jar");
  choose(["glass-jar"]);
  const row = order(db, "LOCAL-RECORDED", [line("glass-jar", 3)]);
  assert.equal(reports.recordCompletion(row, actor), true);
  assert.equal(reports.recordCompletion(row, { ...actor, name: "Different Person" }), false);
  const legacy = order(db, "LOCAL-SHARED", [line("glass-jar")], { updated_at: "2026-10-24T10:00:00.000Z" });
  reports.recordCompletion(legacy, { id: "legacy-staff", username: "staff", name: "Staff", role: "staff" });
  order(db, "LOCAL-NO-ATTRIBUTION", [line("glass-jar")], { updated_at: "2026-10-23T10:00:00.000Z" });
  const rows = reports.list(options).groups.flatMap((group) => group.records);
  assert.equal(rows[0].staffName, actor.name);
  assert.equal(rows[0].staffUsername, actor.username);
  assert.equal(rows[0].attribution, "recorded");
  assert.equal(rows[1].staffName, "Shared staff account");
  assert.equal(rows[2].staffName, "Not recorded");
  assert.equal(rows[2].staffUsername, "");
  assert.equal(rows[2].attribution, "not_recorded");
  assert.equal(db.prepare("SELECT actor_ref FROM processed_merchandise_events WHERE order_id=?").get(row.id).actor_ref.length, 64);
});

test("SAST inclusive dates use completion snapshots and stable date-grouped pagination", (t) => {
  const { db, reports, choose } = setup(t);
  product(db, "glass-jar");
  choose(["glass-jar"]);
  order(db, "LOCAL-BEFORE", [line("glass-jar")], { updated_at: "2026-10-24T21:59:59.999Z" });
  const first = order(db, "LOCAL-FIRST", [line("glass-jar", 2)], { updated_at: "2026-10-24T22:00:00.000Z" });
  reports.recordCompletion(first, actor);
  db.prepare("UPDATE orders SET updated_at=? WHERE id=?").run("2026-10-28T12:00:00.000Z", first.id);
  order(db, "LOCAL-LAST", [line("glass-jar", 3)], { status: "delivered", updated_at: "2026-10-25T21:59:59.999Z" });
  order(db, "LOCAL-AFTER", [line("glass-jar")], { updated_at: "2026-10-25T22:00:00.000Z" });
  const day = reports.list({ from: "2026-10-25", to: "2026-10-25" });
  assert.equal(day.total, 2);
  assert.equal(day.summary.units, 5);
  assert.equal(day.groups.length, 1);
  assert.equal(day.groups[0].date, "2026-10-25");
  assert.deepEqual(day.groups[0].records.map((item) => item.id), ["LOCAL-LAST", "LOCAL-FIRST"]);
  const firstPage = reports.list({ ...options, page: "1", limit: "2" });
  const secondPage = reports.list({ ...options, page: "2", limit: "2" });
  assert.equal(firstPage.total, 4);
  assert.equal(secondPage.total, 4);
  assert.equal(firstPage.groups[0].date, "2026-10-26");
  const allIds = [...firstPage.groups, ...secondPage.groups].flatMap((group) => group.records.map((item) => item.id));
  assert.equal(new Set(allIds).size, 4);
  assert.deepEqual(allIds, ["LOCAL-AFTER", "LOCAL-LAST", "LOCAL-FIRST", "LOCAL-BEFORE"]);
});

test("scope checks require both historical and current merchandise classification", (t) => {
  const { db, reports, choose } = setup(t);
  product(db, "glass-jar");
  choose(["glass-jar"]);
  const historicalRestricted = order(db, "LOCAL-HISTORY-RESTRICTED", [line("glass-jar", 1, { category: "Flower" })]);
  assert.equal(reports.recordCompletion(historicalRestricted, actor), false);
  assert.equal(reports.list(options).total, 0);
  const row = order(db, "LOCAL-SAFE-HISTORY", [line("glass-jar")]);
  reports.recordCompletion(row, actor);
  assert.equal(reports.list(options).total, 1);
  db.prepare("UPDATE catalog_products SET product_json=? WHERE id=?")
    .run(JSON.stringify({ id: "glass-jar", name: "Changed classification", category: "Flower" }), "glass-jar");
  assert.equal(reports.settings().products.length, 0);
  assert.deepEqual(reports.settings().selectedProductIds, []);
  assert.equal(reports.list(options).total, 0);
});

test("completion metadata and settings participate in caller transactions and fail atomically", (t) => {
  const { db, reports, choose } = setup(t);
  product(db, "glass-jar");
  db.exec("BEGIN IMMEDIATE");
  choose(["glass-jar"]);
  const rolled = order(db, "LOCAL-ROLLBACK", [line("glass-jar")]);
  reports.recordCompletion(rolled, actor);
  assert.equal(db.isTransaction, true);
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT count(*) AS count FROM orders").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM processed_merchandise_events").get().count, 0);
  assert.deepEqual(reports.settings().selectedProductIds, []);
  assert.equal(reports.settings().revision, 1);
  choose(["glass-jar"]);
  order(db, "LOCAL-FAILURE", [line("glass-jar")], { status: "ready_for_pickup" });
  db.exec("CREATE TRIGGER fail_local_attribution BEFORE INSERT ON processed_merchandise_events BEGIN SELECT RAISE(ABORT,'local test persistence failure'); END;");
  db.exec("BEGIN IMMEDIATE");
  db.prepare("UPDATE orders SET status='completed' WHERE id=?").run("LOCAL-FAILURE");
  const current = db.prepare("SELECT * FROM orders WHERE id=?").get("LOCAL-FAILURE");
  assert.throws(() => reports.recordCompletion(current, actor), /local test persistence failure/);
  assert.equal(db.isTransaction, true);
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT status FROM orders WHERE id=?").get("LOCAL-FAILURE").status, "ready_for_pickup");
  assert.equal(db.prepare("SELECT count(*) AS count FROM processed_merchandise_events").get().count, 0);
});

test("filters reject invalid or oversized ranges and reports never assume an implicit product selection", (t) => {
  const { db, reports } = setup(t);
  product(db, "glass-jar");
  order(db, "LOCAL-UNSELECTED", [line("glass-jar")]);
  const empty = reports.list();
  assert.deepEqual(empty.groups, []);
  assert.deepEqual(empty.summary, { records: 0, units: 0 });
  assert.equal(empty.from, "2026-09-26");
  assert.equal(empty.to, "2026-10-25");
  assert.equal(empty.timeZone, "Africa/Johannesburg");
  for (const value of [
    null, [], { from: "2026-02-30" }, { from: "2026-1-01" }, { from: "not-a-date" },
    { from: "2026-10-26", to: "2026-10-25" }, { from: "2025-01-01", to: "2026-01-02" },
    { limit: "0" }, { limit: "101" }, { page: "0" }, { page: "1.5" },
    { productIds: ["glass-jar"] }, { to: 123 },
  ]) assert.throws(() => reports.list(value), statusError(422));
  assert.equal(reports.list({ from: "2024-01-01", to: "2024-12-31" }).total, 0);
});
