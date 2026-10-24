import { randomBytes, createHash } from "node:crypto";
import { products as initialProducts, categories } from "../src/lib/products.js";
import { productMediaId } from "./product-media.mjs";

export class CatalogError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

const CATEGORIES = categories.slice(1);
const STATUSES = ["draft", "published", "archived"];
const COLLECTIONS = ["Signature", "Reserve", "Ritual"];
const VISUALS = ["flower", "preroll", "gummies", "vape", "drink", "accessory"];
const CATEGORY_VISUAL = {
  Flower: "flower", "Pre-rolls": "preroll", Edibles: "gummies",
  Vapes: "vape", Drinks: "drink", Accessories: "accessory",
};
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PRODUCTS = 1000;
const MAX_PRICE = 100_000_000;
const PUBLIC_FIELDS = [
  "id", "name", "category", "price", "size", "type", "description", "effect",
  "flavor", "mood", "serving", "thc", "collection", "visual", "color", "badge",
  "badgeType", "featured", "imageUrl", "sizes", "catalogStatus", "priceStatus",
  "potencyStatus", "availability",
];
const EDITABLE = new Set([...PUBLIC_FIELDS.filter((key) => key !== "id"), "status"]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clean = (value) => typeof value === "string" ? value.trim() : "";
const priceValid = (value) => Number.isSafeInteger(value) && value >= 1 && value <= MAX_PRICE;
const idValid = (value) => typeof value === "string" && value.length >= 2 && value.length <= 96 && ID_PATTERN.test(value);
const badControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function imageUrlValid(value) {
  if (!value) return true;
  if (productMediaId(value)) return true;
  // Images are displayed directly by the visitor's browser; the server never
  // fetches staff-supplied URLs. Disallow executable formats and URL schemes.
  const raster = /\.(?:jpe?g|png|webp|avif)$/i;
  if (value.startsWith("/images/")) {
    return /^\/images\/[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value) &&
      !value.split("/").includes("..") && !value.includes("//") && raster.test(value);
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.hash && !url.port && raster.test(url.pathname) &&
      url.hostname.includes(".") && !url.hostname.endsWith(".local") &&
      url.hostname !== "localhost" && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
      !url.hostname.includes(":");
  } catch { return false; }
}

function slug(name) {
  const prefix = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72).replace(/-$/, "");
  return `${prefix || "product"}-${randomBytes(5).toString("hex")}`;
}

export function createCatalog({ db, ErrorType = CatalogError, now = Date.now, seedProducts = initialProducts } = {}) {
  if (!db) throw new TypeError("A SQLite database is required.");
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS catalog_products (
      id TEXT PRIMARY KEY, product_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
      revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS catalog_products_status ON catalog_products(status, created_at, id);
    CREATE TABLE IF NOT EXISTS catalog_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL,
      action TEXT NOT NULL, actor_ref TEXT NOT NULL, revision INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const get = db.prepare("SELECT * FROM catalog_products WHERE id = ?");
  const insert = db.prepare("INSERT INTO catalog_products (id,product_json,status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?)");
  const updateRow = db.prepare("UPDATE catalog_products SET product_json=?, status=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?");
  const auditRow = db.prepare("INSERT INTO catalog_audit (product_id,action,actor_ref,revision,created_at) VALUES (?,?,?,?,?)");
  const stamp = () => new Date(now()).toISOString();

  function atomic(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function decode(row, admin = false) {
    if (!row) return null;
    const data = JSON.parse(row.product_json);
    const product = Object.fromEntries(PUBLIC_FIELDS.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
    product.id = row.id;
    if (admin) Object.assign(product, {
      status: row.status, revision: row.revision,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
    return product;
  }
  function audit(id, action, actor, revision, timestamp) {
    // Shared staff sessions do not identify an individual employee. Record a
    // one-way reference, never a raw session token or caller-provided notes.
    const ref = createHash("sha256").update(typeof actor === "string" ? actor : "staff").digest("hex");
    auditRow.run(id, action, ref, revision, timestamp);
  }

  function validate(body, previous = null, creating = false) {
    if (!isRecord(body)) throw new ErrorType(400, "Submit product details as an object.");
    const errors = Object.create(null);
    for (const key of Object.keys(body)) {
      if (!EDITABLE.has(key) && key !== "revision" && !(creating && key === "id"))
        errors[key] = "This product field cannot be changed.";
    }
    const value = { ...(previous || {}), ...body };
    const result = {};
    const text = (key, min, max, fallback = "") => {
      const raw = value[key] === undefined ? fallback : value[key];
      if (typeof raw !== "string" || clean(raw).length < min || clean(raw).length > max || badControls.test(raw))
        errors[key] = `Enter ${key} using ${min}–${max} characters.`;
      result[key] = clean(raw);
    };
    text("name", 2, 120);
    text("category", 1, 40, "Accessories");
    if (!CATEGORIES.includes(result.category)) errors.category = "Choose an available product category.";
    text("size", 1, 80, "Standard");
    text("description", 10, 4000);
    text("type", 1, 40, result.category === "Accessories" ? "Accessory" : "Hybrid");
    for (const key of ["effect", "flavor", "mood", "serving", "thc"]) text(key, 0, 500, key === "thc" ? (result.category === "Accessories" ? "Not applicable" : "Confirm on label") : "");
    text("collection", 1, 40, "Signature");
    if (!COLLECTIONS.includes(result.collection)) errors.collection = "Choose Signature, Reserve or Ritual.";
    text("visual", 1, 30, CATEGORY_VISUAL[result.category] || "accessory");
    if (!VISUALS.includes(result.visual)) errors.visual = "Choose an available presentation style.";
    text("color", 7, 7, "#171a15");
    if (!/^#[0-9a-f]{6}$/i.test(result.color)) errors.color = "Use a six-digit hex colour such as #171a15.";
    text("badge", 0, 80);
    text("badgeType", 1, 20, "green");
    if (!["orange", "pink", "green"].includes(result.badgeType)) errors.badgeType = "Choose an available badge colour.";
    text("imageUrl", 0, 2048);
    if (!imageUrlValid(result.imageUrl)) errors.imageUrl = "Use a direct HTTPS JPG, PNG, WebP or AVIF image URL, or a valid /images/ path.";
    const uploadedImageId = productMediaId(result.imageUrl);
    if (uploadedImageId && (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_media'").get() ||
        !db.prepare("SELECT id FROM product_media WHERE id=?").get(uploadedImageId)))
      errors.imageUrl = "Upload this product photograph again before saving.";
    text("availability", 0, 160, "Awaiting store confirmation");
    for (const [key, values, fallback] of [
      ["catalogStatus", ["approved", "unapproved"], "unapproved"],
      ["priceStatus", ["confirmed", "indicative"], "indicative"],
      ["potencyStatus", ["verified", "unverified"], "unverified"],
    ]) {
      text(key, 1, 20, fallback);
      if (!values.includes(result[key])) errors[key] = `Choose ${values.join(" or ")}.`;
    }
    result.price = value.price;
    if (!priceValid(result.price)) errors.price = "Enter a positive price in whole cents, at most R1,000,000.";
    result.featured = value.featured === undefined ? false : value.featured;
    if (typeof result.featured !== "boolean") errors.featured = "Featured must be true or false.";
    const status = value.status === undefined ? "draft" : value.status;
    if (!STATUSES.includes(status)) errors.status = "Choose draft, published or archived.";
    if (value.sizes !== undefined && value.sizes !== null && !(Array.isArray(value.sizes) && value.sizes.length === 0)) {
      if (!Array.isArray(value.sizes) || value.sizes.length < 1 || value.sizes.length > 12) {
        errors.sizes = "Provide between 1 and 12 size options, or remove size options.";
      } else {
        const labels = new Set();
        result.sizes = value.sizes.map((size) => {
          if (!isRecord(size) || Object.keys(size).some((key) => !["label", "price"].includes(key)) ||
              typeof size.label !== "string" || clean(size.label).length < 1 || clean(size.label).length > 80 ||
              badControls.test(size.label) || !priceValid(size.price)) {
            errors.sizes = "Every size needs a label and a positive price in whole cents.";
            return { label: "", price: 0 };
          }
          const label = clean(size.label);
          if (labels.has(label.toLocaleLowerCase("en-ZA"))) errors.sizes = "Size labels must be unique.";
          labels.add(label.toLocaleLowerCase("en-ZA"));
          return { label, price: size.price };
        });
        if (result.sizes[0].label !== result.size || result.sizes[0].price !== result.price)
          errors.sizes = "The first size option must match the product's display size and base price.";
      }
    }
    if (Object.keys(errors).length) throw new ErrorType(422, "Please check the product details.", errors);
    return { product: result, status };
  }

  if (!db.prepare("SELECT value FROM catalog_settings WHERE key='seed_v1'").get()) {
    atomic(() => {
      const timestamp = stamp();
      for (const product of seedProducts) {
        if (!idValid(product.id)) throw new TypeError("Invalid seed product ID.");
        if (!get.get(product.id)) insert.run(product.id, JSON.stringify(product), "published", 1, timestamp, timestamp);
      }
      db.prepare("INSERT INTO catalog_settings (key,value) VALUES ('seed_v1',?)").run(timestamp);
    });
  }

  function listPublic() {
    return db.prepare("SELECT * FROM catalog_products WHERE status='published' ORDER BY created_at,rowid").all().map((row) => decode(row));
  }
  function findPublished(id) {
    const row = typeof id === "string" ? get.get(id) : null;
    return row?.status === "published" ? decode(row) : null;
  }
  function productIds() {
    return db.prepare("SELECT id FROM catalog_products WHERE status != 'archived' ORDER BY id").all().map((row) => row.id);
  }
  function listAdmin({ status = "all", search = "", limit = 50, offset = 0 } = {}) {
    if (!["all", ...STATUSES].includes(status)) throw new ErrorType(422, "Choose an available product status.");
    if (typeof search !== "string" || search.length > 120) throw new ErrorType(422, "Keep the product search under 120 characters.");
    limit = typeof limit === "string" && /^\d+$/.test(limit) ? Number(limit) : limit;
    offset = typeof offset === "string" && /^\d+$/.test(offset) ? Number(offset) : offset;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000)
      throw new ErrorType(422, "Choose a page size from 1 to 100 and a valid offset.");
    const searchTerm = `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const where = "(?='all' OR status=?) AND (json_extract(product_json,'$.name') LIKE ? ESCAPE '\\' COLLATE NOCASE OR json_extract(product_json,'$.category') LIKE ? ESCAPE '\\' COLLATE NOCASE OR id LIKE ? ESCAPE '\\' COLLATE NOCASE)";
    const params = [status, status, searchTerm, searchTerm, searchTerm];
    const total = db.prepare(`SELECT count(*) AS total FROM catalog_products WHERE ${where}`).get(...params).total;
    const rows = db.prepare(`SELECT * FROM catalog_products WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { products: rows.map((row) => decode(row, true)), total, limit, offset };
  }
  function create(body, actor) {
    const { product, status } = validate(body, null, true);
    const id = body.id === undefined ? slug(product.name) : body.id;
    if (!idValid(id)) throw new ErrorType(422, "Use a product ID with 2–96 lowercase letters, digits and single hyphens.", { id: "Enter a valid product ID." });
    return atomic(() => {
      if (db.prepare("SELECT count(*) AS total FROM catalog_products").get().total >= MAX_PRODUCTS)
        throw new ErrorType(409, "The catalog has reached its 1,000-product limit. Contact the site administrator.");
      if (get.get(id)) throw new ErrorType(409, "This product ID already exists.");
      const timestamp = stamp();
      insert.run(id, JSON.stringify({ id, ...product }), status, 1, timestamp, timestamp);
      audit(id, "created", actor, 1, timestamp);
      return decode(get.get(id), true);
    });
  }
  function update(id, body, actor) {
    if (!idValid(id)) throw new ErrorType(404, "Product not found.");
    if (!isRecord(body)) throw new ErrorType(400, "Submit product details as an object.");
    if (!Number.isSafeInteger(body.revision) || body.revision < 1)
      throw new ErrorType(422, "Include the product revision before saving.", { revision: "Reload this product before saving." });
    return atomic(() => {
      const row = get.get(id);
      if (!row) throw new ErrorType(404, "Product not found.");
      if (row.revision !== body.revision) throw new ErrorType(409, "This product was changed by another staff session. Refresh it before saving.");
      const previous = decode(row, true);
      const { product, status } = validate(body, previous);
      const timestamp = stamp();
      const saved = updateRow.run(JSON.stringify({ id, ...product }), status, timestamp, id, body.revision);
      if (Number(saved.changes) !== 1) throw new ErrorType(409, "This product changed. Refresh it before saving.");
      audit(id, status !== row.status ? status : "updated", actor, row.revision + 1, timestamp);
      return decode(get.get(id), true);
    });
  }
  function archive(id, body, actor) {
    if (!isRecord(body) || Object.keys(body).some((key) => key !== "revision"))
      throw new ErrorType(400, "Include only the product revision when archiving.");
    return update(id, { revision: body.revision, status: "archived" }, actor);
  }
  return { listPublic, findPublished, productIds, listAdmin, create, update, archive };
}
