import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const MEDIA_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MEDIA_URL = /^\/media\/products\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.webp$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function productMediaId(url) {
  return typeof url === "string" ? MEDIA_URL.exec(url)?.[1] || "" : "";
}

/** Private staff uploads become public only while a published product uses them. */
export function createProductMedia({
  db, HttpError, now = Date.now, maxStoredBytes = 128 * 1024 * 1024,
} = {}) {
  if (!db || !HttpError) throw new TypeError("A database and HTTP error type are required.");
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_media (
      id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, image_blob BLOB NOT NULL,
      byte_size INTEGER NOT NULL, content_hash TEXT NOT NULL,
      actor_ref TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS product_media_created ON product_media(created_at);
  `);
  let activeUploads = 0;
  const byId = db.prepare("SELECT * FROM product_media WHERE id=?");
  const catalogPresent = () => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_products'").get());
  const inUse = (url, publicOnly = false) => catalogPresent() && Boolean(db.prepare(
    `SELECT id FROM catalog_products WHERE json_valid(product_json) AND json_extract(product_json,'$.imageUrl')=? ${publicOnly ? "AND status='published'" : ""} LIMIT 1`,
  ).get(url));

  function cleanup() {
    const rows = db.prepare("SELECT id,url FROM product_media WHERE created_at<=?")
      .all(new Date(now() - ORPHAN_AGE_MS).toISOString());
    const remove = db.prepare("DELETE FROM product_media WHERE id=?");
    for (const row of rows) if (!inUse(row.url)) remove.run(row.id);
  }
  function checkCapacity(incoming = 0) {
    const usage = db.prepare("SELECT COALESCE(SUM(byte_size),0) AS bytes,COUNT(*) AS count FROM product_media").get();
    if (usage.bytes + incoming > maxStoredBytes || usage.count >= 5000)
      throw new HttpError(409, "Product photo storage is full. Remove unused photos or contact the administrator.");
  }
  async function decode(image) {
    if (!record(image) || Object.keys(image).some((key) => key !== "data") ||
        typeof image.data !== "string" || !image.data.length ||
        image.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || image.data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))
      throw new HttpError(422, "Choose a JPEG, PNG or WebP photo of at most 6 MiB.", { image: "Choose a valid product photograph." });
    const input = Buffer.from(image.data, "base64");
    if (input.length < 100 || input.length > MAX_FILE_BYTES)
      throw new HttpError(422, "Choose a readable JPEG, PNG or WebP photo of at most 6 MiB.", { image: "This photograph is empty or too large." });
    try {
      const metadata = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "warning" }).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages || 1) !== 1 ||
          metadata.width < 64 || metadata.height < 64 || metadata.width * metadata.height > MAX_PIXELS)
        throw new Error("Unsupported photo");
      return await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "warning" })
        .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86 }).toBuffer();
    } catch {
      throw new HttpError(422,
        "Choose a clear, static JPEG, PNG or WebP photograph between 64 pixels wide/high and 20 megapixels.",
        { image: "This photograph could not be read safely." });
    }
  }
  async function upload(body, actorRef, { assertAuthorized } = {}) {
    if (!record(body) || Object.keys(body).some((key) => key !== "image"))
      throw new HttpError(400, "Submit the product photograph as an image request.");
    if (activeUploads >= 2)
      throw new HttpError(503, "Product photo uploads are busy. Please try again shortly.");
    cleanup();
    checkCapacity();
    activeUploads += 1;
    let bytes;
    try { bytes = await decode(body.image); } finally { activeUploads -= 1; }
    const id = randomUUID();
    const url = `/media/products/${id}.webp`;
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      if (assertAuthorized) assertAuthorized();
      checkCapacity(bytes.length);
      db.prepare("INSERT INTO product_media (id,url,image_blob,byte_size,content_hash,actor_ref,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, url, bytes, bytes.length, createHash("sha256").update(bytes).digest("hex"),
          createHash("sha256").update(String(actorRef || "staff")).digest("hex"), new Date(now()).toISOString());
      if (ownsTransaction) db.exec("COMMIT");
    } catch (error) {
      if (ownsTransaction) db.exec("ROLLBACK");
      throw error;
    }
    return { image: { id, url, previewUrl: `/api/admin/product-images/${id}` } };
  }
  function get(id, { publicOnly = false } = {}) {
    if (typeof id !== "string" || !MEDIA_ID.test(id)) throw new HttpError(404, "Product photo not found.");
    const row = byId.get(id);
    if (!row || (publicOnly && !inUse(row.url, true))) throw new HttpError(404, "Product photo not found.");
    return { bytes: Buffer.from(row.image_blob), contentType: "image/webp", contentHash: row.content_hash };
  }
  function exists(url) {
    const id = productMediaId(url);
    return Boolean(id && byId.get(id));
  }
  cleanup();
  const timer = setInterval(cleanup, 60 * 60 * 1000);
  timer.unref();
  return { upload, get, exists, cleanup, close() { clearInterval(timer); } };
}
