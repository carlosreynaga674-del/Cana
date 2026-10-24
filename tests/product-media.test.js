import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createProductMedia, productMediaId } from "../server/product-media.mjs";
import { createCatalog, CatalogError } from "../server/catalog.mjs";
import { publishedCatalog, safeProductImage } from "../src/lib/catalog.js";

const DAY = 24 * 60 * 60 * 1000;
const details = (imageUrl, overrides = {}) => ({
  name: "Local Photo Test Grinder", category: "Accessories", description: "A synthetic local product used only in automated tests.",
  price: 15000, size: "Standard", imageUrl, ...overrides,
});
async function photo({ width = 640, height = 480, metadata = false } = {}) {
  let image = sharp({ create: { width, height, channels: 3, background: { r: 72, g: 110, b: 45 } } });
  if (metadata) image = image.withMetadata({ exif: { IFD0: { Artist: "Local private metadata fixture" } } });
  return await image.jpeg({ quality: 90 }).toBuffer();
}
const body = (bytes) => ({ image: { data: bytes.toString("base64") } });
function fixture(t, options = {}) {
  const db = new DatabaseSync(":memory:");
  const catalog = createCatalog({ db, seedProducts: [] });
  const media = createProductMedia({ db, HttpError: CatalogError, ...options });
  t.after(() => { media.close(); db.close(); });
  return { db, catalog, media };
}
function isError(status, field) {
  return (error) => error instanceof CatalogError && error.status === status && (!field || Object.hasOwn(error.errors || {}, field));
}

test("product photos are sanitised WebP, keep private metadata out of storage and use safe canonical paths", async (t) => {
  const { db, media } = fixture(t);
  const source = await photo({ width: 2200, height: 1200, metadata: true });
  const result = await media.upload(body(source), "local-sensitive-session-token");
  const image = result.image;
  assert.equal(productMediaId(image.url), image.id);
  assert.equal(image.previewUrl, `/api/admin/product-images/${image.id}`);
  const stored = media.get(image.id);
  const metadata = await sharp(stored.bytes).metadata();
  assert.equal(stored.contentType, "image/webp");
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1600);
  assert.ok(metadata.height <= 1600);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(stored.bytes.includes(Buffer.from("Local private metadata fixture")), false);
  assert.notDeepEqual(stored.bytes, source);
  const row = db.prepare("SELECT * FROM product_media WHERE id=?").get(image.id);
  assert.match(row.actor_ref, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(row).includes("local-sensitive-session-token"), false);
  assert.equal(row.byte_size, stored.bytes.length);
  assert.ok(media.exists(image.url));
});

test("draft photos stay private, publication exposes the actual photo, and archiving immediately withdraws public access", async (t) => {
  const { catalog, media } = fixture(t);
  const { image } = await media.upload(body(await photo()), "staff");
  assert.throws(() => media.get(image.id, { publicOnly: true }), isError(404));
  const draft = catalog.create(details(image.url), "staff");
  assert.throws(() => media.get(image.id, { publicOnly: true }), isError(404));
  assert.ok(media.get(image.id).bytes.length);
  const published = catalog.update(draft.id, { revision: draft.revision, status: "published" }, "staff");
  assert.ok(media.get(image.id, { publicOnly: true }).bytes.length);
  assert.equal(publishedCatalog({ products: catalog.listPublic() })[0].imageUrl, image.url);
  catalog.archive(published.id, { revision: published.revision }, "staff");
  assert.throws(() => media.get(image.id, { publicOnly: true }), isError(404));
  assert.ok(media.get(image.id).bytes.length, "Archived product references retain their photo for later restoration.");
});

test("unsafe, excessive, disguised and unreadable product images never enter storage", async (t) => {
  const { db, media } = fixture(t);
  for (const invalid of [
    {}, { image: [] }, { image: { data: "not-base64!" } },
    { image: { data: "AAAA", filename: "fake.jpg" } },
    { image: { data: "A".repeat(8 * 1024 * 1024 + 4) } },
    body(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="red"/></svg>')),
    body(Buffer.alloc(1000, 99)), body(await photo({ width: 32, height: 32 })),
  ]) await assert.rejects(media.upload(invalid, "staff"), isError(422));
  await assert.rejects(media.upload({ image: body(await photo()).image, filePath: "/private" }, "staff"), isError(400));
  assert.equal(db.prepare("SELECT count(*) AS count FROM product_media").get().count, 0);
  for (const invalid of ["../private", "not-an-id", null]) assert.throws(() => media.get(invalid), isError(404));
  assert.equal(productMediaId("/media/products/../../private.webp"), "");
  assert.equal(safeProductImage("/media/products/not-an-id.webp"), "");
});

test("catalog products cannot reference missing uploads and stale edits cannot expose an uncommitted replacement photo", async (t) => {
  const { catalog, media } = fixture(t);
  assert.throws(() => catalog.create(details("/media/products/12345678-1234-1234-1234-123456789abc.webp"), "staff"), isError(422, "imageUrl"));
  const first = (await media.upload(body(await photo()), "staff")).image;
  const replacement = (await media.upload(body(await photo()), "staff")).image;
  const product = catalog.create(details(first.url, { status: "published" }), "staff");
  const edited = catalog.update(product.id, { revision: product.revision, name: "Another current name" }, "staff");
  assert.throws(() => catalog.update(product.id, { revision: product.revision, imageUrl: replacement.url }, "staff"), isError(409));
  assert.equal(catalog.findPublished(product.id).imageUrl, first.url);
  assert.ok(media.get(first.id, { publicOnly: true }).bytes.length);
  assert.throws(() => media.get(replacement.id, { publicOnly: true }), isError(404));
  catalog.update(product.id, { revision: edited.revision, imageUrl: replacement.url }, "staff");
  assert.throws(() => media.get(first.id, { publicOnly: true }), isError(404));
  assert.ok(media.get(replacement.id, { publicOnly: true }).bytes.length);
});

test("revoking staff authority during image processing prevents a photo from being committed", async (t) => {
  const { db, media } = fixture(t);
  let checked = false;
  await assert.rejects(media.upload(body(await photo()), "staff", { assertAuthorized() {
    checked = true;
    throw new CatalogError(401, "Revoked fixture session");
  } }), isError(401));
  assert.equal(checked, true);
  assert.equal(db.prepare("SELECT count(*) AS count FROM product_media").get().count, 0);
  assert.ok((await media.upload(body(await photo()), "valid-session")).image.id);
});

test("photo decoding is globally bounded and storage quota failures cannot leave partial rows", async (t) => {
  const { db, media } = fixture(t);
  const request = body(await photo());
  const first = media.upload(request, "one");
  const second = media.upload(request, "two");
  await assert.rejects(media.upload(request, "three"), isError(503));
  await Promise.all([first, second]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM product_media").get().count, 2);
  const limited = createProductMedia({ db, HttpError: CatalogError, maxStoredBytes: 1 });
  t.after(() => limited.close());
  await assert.rejects(limited.upload(request, "staff"), isError(409));
  assert.equal(db.prepare("SELECT count(*) AS count FROM product_media").get().count, 2);
  db.exec("CREATE TRIGGER reject_product_media BEFORE INSERT ON product_media BEGIN SELECT RAISE(ABORT, 'local media audit failure'); END;");
  await assert.rejects(media.upload(request, "staff"), /local media audit failure/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM product_media").get().count, 2);
});

test("orphan cleanup expires abandoned uploads but retains every referenced draft or archived photo", async (t) => {
  let clock = Date.now();
  const { catalog, media } = fixture(t, { now: () => clock });
  const referenced = (await media.upload(body(await photo()), "staff")).image;
  const orphan = (await media.upload(body(await photo()), "staff")).image;
  const draft = catalog.create(details(referenced.url), "staff");
  clock += DAY + 1;
  media.cleanup();
  assert.equal(media.exists(orphan.url), false);
  assert.equal(media.exists(referenced.url), true);
  catalog.archive(draft.id, { revision: draft.revision }, "staff");
  clock += DAY;
  media.cleanup();
  assert.equal(media.exists(referenced.url), true);
  const current = catalog.listAdmin().products[0];
  catalog.update(current.id, { revision: current.revision, imageUrl: "" }, "staff");
  media.cleanup();
  assert.equal(media.exists(referenced.url), false);
});

test("uploaded photos and publication survive database restart without external image hosting", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-product-media-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "products.sqlite");
  let db = new DatabaseSync(filename);
  let catalog = createCatalog({ db, seedProducts: [] });
  let media = createProductMedia({ db, HttpError: CatalogError });
  const { image } = await media.upload(body(await photo()), "staff");
  catalog.create(details(image.url, { status: "published" }), "staff");
  const expected = media.get(image.id).bytes;
  media.close(); db.close();
  db = new DatabaseSync(filename);
  catalog = createCatalog({ db, seedProducts: [] });
  media = createProductMedia({ db, HttpError: CatalogError });
  t.after(() => { media.close(); db.close(); });
  assert.equal(catalog.listPublic()[0].imageUrl, image.url);
  assert.deepEqual(media.get(image.id, { publicOnly: true }).bytes, expected);
});
