import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCatalog, CatalogError } from "../server/catalog.mjs";
import { products } from "../src/lib/products.js";

const product = (overrides = {}) => ({
  name: "Local Test Storage Jar",
  category: "Accessories",
  description: "An accessory used only by the local catalog test fixture.",
  price: 12500,
  size: "1 jar",
  ...overrides,
});

function fixture(t, options = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  return { db, catalog: createCatalog({ db, ...options }) };
}

function rejects(action, status, field) {
  assert.throws(action, (error) => error instanceof CatalogError &&
    error.status === status && (!field || Object.hasOwn(error.errors || {}, field)));
}

test("catalog seeds the collection once and keeps staff changes, archives and removals across restarts", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-catalog-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "catalog.sqlite");
  let db = new DatabaseSync(filename);
  let catalog = createCatalog({ db });
  assert.deepEqual(catalog.listPublic().map((p) => p.id), products.map((p) => p.id));
  const first = catalog.listAdmin().products.find((p) => p.id === "sunset-sherbet");
  catalog.update(first.id, { revision: first.revision, name: "Staff Edited Name" }, "staff-session-test-only");
  const second = catalog.listAdmin().products.find((p) => p.id === "daydream");
  catalog.archive(second.id, { revision: second.revision }, "staff-session-test-only");
  db.prepare("DELETE FROM catalog_products WHERE id = ?").run("peach-state");
  db.close();

  db = new DatabaseSync(filename);
  t.after(() => db.close());
  catalog = createCatalog({ db, seedProducts: [...products, { ...products[0], id: "new-source-proposal" }] });
  assert.equal(catalog.findPublished("sunset-sherbet").name, "Staff Edited Name");
  assert.equal(catalog.findPublished("daydream"), null);
  assert.equal(catalog.findPublished("peach-state"), null);
  assert.equal(catalog.findPublished("new-source-proposal"), null);
  assert.equal(catalog.listAdmin({ status: "archived" }).total, 1);
});

test("draft publication, edits and archive immediately change the authoritative storefront catalog", (t) => {
  const { catalog } = fixture(t, { seedProducts: [] });
  const created = catalog.create(product(), "staff-a");
  assert.equal(created.status, "draft");
  assert.equal(created.catalogStatus, "unapproved");
  assert.equal(created.priceStatus, "indicative");
  assert.equal(created.potencyStatus, "unverified");
  assert.equal(catalog.findPublished(created.id), null);
  assert.deepEqual(catalog.listPublic(), []);
  assert.ok(catalog.productIds().includes(created.id));

  const published = catalog.update(created.id, { revision: 1, status: "published" }, "staff-a");
  assert.equal(published.revision, 2);
  assert.equal(catalog.findPublished(created.id).price, 12500);
  assert.equal(catalog.listPublic().length, 1);
  // Publishing is deliberately separate from factual business catalog approval.
  assert.equal(catalog.findPublished(created.id).catalogStatus, "unapproved");
  const edited = catalog.update(created.id, { revision: 2, price: 15000, imageUrl: "https://cdn.example.com/jar.webp?version=2" }, "staff-b");
  assert.equal(catalog.findPublished(created.id).price, 15000);
  assert.equal(catalog.findPublished(created.id).imageUrl, edited.imageUrl);
  assert.equal(edited.description, created.description);
  catalog.archive(created.id, { revision: 3 }, "staff-b");
  assert.equal(catalog.findPublished(created.id), null);
  assert.deepEqual(catalog.productIds(), []);
  assert.equal(catalog.listAdmin({ status: "archived" }).products[0].revision, 4);
  const publicProduct = { ...catalog.listAdmin().products[0], revision: 4, status: "published" };
  // Archive is reversible; no deletion can corrupt historical order snapshots.
  catalog.update(publicProduct.id, { revision: 4, status: "published" }, "staff-a");
  assert.equal(catalog.listPublic().length, 1);
});

test("public product responses exclude staff state, audit references and arbitrary JSON properties", (t) => {
  const { db, catalog } = fixture(t, { seedProducts: [] });
  const created = catalog.create(product({ status: "published", imageUrl: "/images/reference-accessory.webp" }), "sensitive-test-session-token");
  const publicProduct = catalog.findPublished(created.id);
  assert.equal(publicProduct.name, created.name);
  for (const privateKey of ["revision", "status", "createdAt", "updatedAt", "actor_ref", "password", "notes"])
    assert.equal(Object.hasOwn(publicProduct, privateKey), false);
  const data = JSON.parse(db.prepare("SELECT product_json FROM catalog_products WHERE id=?").get(created.id).product_json);
  data.internalSecret = "must-never-be-public";
  db.prepare("UPDATE catalog_products SET product_json=? WHERE id=?").run(JSON.stringify(data), created.id);
  assert.equal(catalog.listPublic()[0].internalSecret, undefined);
  const audit = db.prepare("SELECT * FROM catalog_audit WHERE product_id=?").get(created.id);
  assert.equal(audit.action, "created");
  assert.match(audit.actor_ref, /^[a-f0-9]{64}$/);
  assert.notEqual(audit.actor_ref, "sensitive-test-session-token");
  assert.equal(JSON.stringify(audit).includes("sensitive-test-session-token"), false);
});

test("catalog rejects malformed values and executable image URLs without saving a partial product", (t) => {
  const { catalog } = fixture(t, { seedProducts: [] });
  const badCases = [
    [{ price: -1 }, "price"], [{ price: 123.4 }, "price"], [{ price: "12500" }, "price"],
    [{ price: 100_000_001 }, "price"], [{ category: "Unknown" }, "category"],
    [{ name: "x" }, "name"], [{ description: "tiny" }, "description"],
    [{ description: "bad\u0000description" }, "description"],
    [{ collection: "Anything" }, "collection"], [{ featured: "true" }, "featured"],
    [{ color: "red; url(evil)" }, "color"], [{ status: "public" }, "status"],
    [{ catalogStatus: "verified" }, "catalogStatus"], [{ secretStaffNote: "never" }, "secretStaffNote"],
  ];
  for (const [invalid, field] of badCases) rejects(() => catalog.create(product(invalid), "staff"), 422, field);
  for (const imageUrl of [
    "javascript:alert(1)", "data:image/svg+xml,<svg/>", "/images/a.svg", "/images/../private.png",
    "//evil.example/image.png", "/images/a.png?query=bad", "http://example.com/a.png",
    "https://name:password@example.com/a.png", "https://example.com/a.svg", "https://example.com/a.html",
    "https://localhost/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://example.com:8080/a.png",
  ]) rejects(() => catalog.create(product({ imageUrl }), "staff"), 422, "imageUrl");
  rejects(() => catalog.create([], "staff"), 400);
  rejects(() => catalog.create(product({ id: "Bad/../../id" }), "staff"), 422, "id");
  assert.equal(catalog.listAdmin().total, 0);
});

test("size options retain server-authoritative prices and can be explicitly removed", (t) => {
  const { catalog } = fixture(t, { seedProducts: [] });
  const created = catalog.create(product({ sizes: [{ label: "1 jar", price: 12500 }, { label: "2 jars", price: 22000 }] }), "staff");
  assert.equal(created.sizes[1].price, 22000);
  rejects(() => catalog.update(created.id, { revision: 1, price: 13000 }, "staff"), 422, "sizes");
  for (const sizes of [
    [{ label: "wrong base", price: 12500 }], [{ label: "1 jar", price: -1 }],
    [{ label: "1 jar", price: 12500 }, { label: "1 JAR", price: 22000 }],
    [{ label: "1 jar", price: 12500, adminOnly: "no" }], "not-an-array",
  ]) rejects(() => catalog.create(product({ sizes }), "staff"), 422, "sizes");
  const changed = catalog.update(created.id, { revision: 1, price: 13000, sizes: [] }, "staff");
  assert.equal(changed.price, 13000);
  assert.equal(changed.sizes, undefined);
  const again = catalog.update(created.id, { revision: 2, sizes: null }, "staff");
  assert.equal(again.sizes, undefined);
});

test("stale product revisions and immutable ID changes never overwrite another staff member's work", (t) => {
  const { db, catalog } = fixture(t, { seedProducts: [] });
  const created = catalog.create(product({ id: "local-storage-jar" }), "staff-a");
  catalog.update(created.id, { revision: 1, name: "Updated by Staff A" }, "staff-a");
  rejects(() => catalog.update(created.id, { revision: 1, name: "Stale Staff B" }, "staff-b"), 409);
  rejects(() => catalog.archive(created.id, { revision: 1 }, "staff-b"), 409);
  rejects(() => catalog.update(created.id, { revision: 2, id: "changed-id" }, "staff-b"), 422, "id");
  rejects(() => catalog.update(created.id, { name: "No Revision" }, "staff-b"), 422, "revision");
  rejects(() => catalog.create(product({ id: created.id }), "staff-b"), 409);
  rejects(() => catalog.update("not-found", { revision: 1, name: "Missing" }, "staff-b"), 404);
  assert.equal(catalog.listAdmin().products[0].name, "Updated by Staff A");
  assert.equal(db.prepare("SELECT count(*) AS count FROM catalog_audit").get().count, 2);
});

test("product writes and their audit entry commit atomically", (t) => {
  const { db, catalog } = fixture(t, { seedProducts: [] });
  const created = catalog.create(product(), "staff");
  db.exec("CREATE TRIGGER reject_catalog_audit BEFORE INSERT ON catalog_audit BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;");
  assert.throws(() => catalog.update(created.id, { revision: 1, name: "Must Roll Back" }, "staff"), /test audit failure/);
  assert.equal(catalog.listAdmin().products[0].name, created.name);
  assert.equal(catalog.listAdmin().products[0].revision, 1);
  assert.throws(() => catalog.create(product({ name: "Must Not Be Inserted" }), "staff"), /test audit failure/);
  assert.equal(catalog.listAdmin().total, 1);
});

test("catalog searches escape SQL wildcards, paginate deterministically and enforce bounded list requests", (t) => {
  const { catalog } = fixture(t, { seedProducts: [] });
  catalog.create(product({ name: "A Literal 100% Item" }), "staff");
  catalog.create(product({ name: "Another Local Item", status: "published" }), "staff");
  catalog.create(product({ name: "Final Local Item", status: "archived" }), "staff");
  assert.equal(catalog.listAdmin({ search: "%" }).total, 1);
  assert.equal(catalog.listAdmin({ search: "_' OR 1=1 --" }).total, 0);
  assert.equal(catalog.listAdmin({ status: "published" }).total, 1);
  const first = catalog.listAdmin({ limit: "1", offset: "0" });
  const second = catalog.listAdmin({ limit: 1, offset: 1 });
  assert.equal(first.products.length, 1);
  assert.equal(first.total, 3);
  assert.notEqual(first.products[0].id, second.products[0].id);
  for (const query of [{ limit: 101 }, { limit: 0 }, { limit: "1 OR 1=1" }, { offset: -1 }, { offset: 100001 }, { status: "unknown" }, { search: "x".repeat(121) }])
    rejects(() => catalog.listAdmin(query), 422);
});
