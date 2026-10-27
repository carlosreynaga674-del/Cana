import { createHash, randomUUID } from "node:crypto";

const LIMIT = 3;
const FIELDS = ["label", "address", "city", "postcode"];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const controls = /[\u0000-\u001f\u007f]/;
const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase("en-ZA").replace(/\s+/gu, " ").trim();
const addressKey = (value) => createHash("sha256")
  .update(JSON.stringify([normalize(value.address), normalize(value.city), normalize(value.postcode)]))
  .digest("hex");

/** Private address book. Automatic reuse is limited to ordinary merchandise. */
export function createMemberAddresses({ db, HttpError, now = Date.now } = {}) {
  if (!db || typeof HttpError !== "function")
    throw new TypeError("A database and HTTP error type are required.");
  db.exec(
    "CREATE TABLE IF NOT EXISTS member_addresses (" +
      "id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE," +
      "label TEXT NOT NULL,address TEXT NOT NULL,city TEXT NOT NULL,postcode TEXT NOT NULL," +
      "address_key TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1)," +
      "created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_used_at TEXT," +
      "UNIQUE(member_id,address_key));",
  );
  const member = db.prepare("SELECT id FROM members WHERE id=?");
  const ownAddress = db.prepare("SELECT * FROM member_addresses WHERE member_id=? AND id=?");
  const matchingAddress = db.prepare("SELECT * FROM member_addresses WHERE member_id=? AND address_key=?");
  const addressCount = db.prepare("SELECT COUNT(*) AS count FROM member_addresses WHERE member_id=?");
  const rows = db.prepare("SELECT * FROM member_addresses WHERE member_id=? ORDER BY COALESCE(last_used_at,created_at) DESC,created_at DESC,id");
  const currentProduct = db.prepare("SELECT product_json FROM catalog_products WHERE id=?");
  const insert = db.prepare(
    "INSERT INTO member_addresses (id,member_id,label,address,city,postcode,address_key,revision,created_at,updated_at,last_used_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)",
  );
  const timestamp = () => new Date(now()).toISOString();

  function atomic(action) {
    const ownsTransaction = !db.isTransaction;
    if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      if (ownsTransaction) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (ownsTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  function assertMember(memberId) {
    if (typeof memberId !== "string" || !member.get(memberId))
      throw new HttpError(404, "Member not found.");
  }

  function owned(memberId, id) {
    const row = typeof id === "string" && id.length <= 100 ? ownAddress.get(memberId, id) : null;
    if (!row) throw new HttpError(404, "Saved address not found.");
    return row;
  }

  function safe(row) {
    return {
      id: row.id, label: row.label, address: row.address, city: row.city,
      postcode: row.postcode, revision: row.revision, createdAt: row.created_at,
      updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
    };
  }

  function validate(body, extra = []) {
    if (!record(body) || Object.keys(body).some((key) => ![...FIELDS, ...extra].includes(key)))
      throw new HttpError(422, "Submit only the supported saved-address fields.");
    const errors = {};
    const value = {};
    for (const [key, max] of [["label", 40], ["address", 240], ["city", 100], ["postcode", 4]]) {
      const text = typeof body[key] === "string" ? body[key].trim() : "";
      if (typeof body[key] !== "string" || !text || text.length > max || controls.test(body[key]))
        errors[key] = "Enter a valid " + key + " within " + max + " characters.";
      value[key] = text;
    }
    if (!/^\d{4}$/.test(value.postcode))
      errors.postcode = "Enter a four-digit South African postal code.";
    if (Object.keys(errors).length)
      throw new HttpError(422, "Please check the saved address.", errors);
    return value;
  }

  function revision(body) {
    if (!record(body) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)
      throw new HttpError(422, "Include the current saved-address revision before changing it.");
    return body.expectedRevision;
  }

  function availableSlot(memberId) {
    if (addressCount.get(memberId).count >= LIMIT)
      throw new HttpError(409, "Your address book is full. Edit or remove one of your three saved addresses before using a new delivery address.");
  }

  function createRow(memberId, value, lastUsedAt = null) {
    availableSlot(memberId);
    const id = randomUUID(), stamp = timestamp();
    insert.run(id, memberId, value.label, value.address, value.city, value.postcode,
      addressKey(value), stamp, stamp, lastUsedAt);
    return safe(owned(memberId, id));
  }

  function list(memberId) {
    assertMember(memberId);
    return { addresses: rows.all(memberId).map(safe), limit: LIMIT };
  }

  function create(memberId, body) {
    assertMember(memberId);
    const value = validate(body);
    return atomic(() => {
      assertMember(memberId);
      if (matchingAddress.get(memberId, addressKey(value)))
        throw new HttpError(409, "That delivery address is already saved. Edit the existing address instead.");
      return createRow(memberId, value);
    });
  }

  function update(memberId, id, body) {
    assertMember(memberId);
    const expected = revision(body);
    const value = validate(body, ["expectedRevision"]);
    return atomic(() => {
      assertMember(memberId);
      const previous = owned(memberId, id);
      if (previous.revision !== expected)
        throw new HttpError(409, "This saved address changed. Refresh it before saving again.");
      const key = addressKey(value);
      const duplicate = matchingAddress.get(memberId, key);
      if (duplicate && duplicate.id !== id)
        throw new HttpError(409, "That delivery address is already saved. Edit the existing address instead.");
      const result = db.prepare("UPDATE member_addresses SET label=?,address=?,city=?,postcode=?,address_key=?,revision=revision+1,updated_at=? WHERE member_id=? AND id=? AND revision=?")
        .run(value.label, value.address, value.city, value.postcode, key, timestamp(), memberId, id, expected);
      if (result.changes !== 1)
        throw new HttpError(409, "This saved address changed. Refresh it before saving again.");
      return safe(owned(memberId, id));
    });
  }

  function remove(memberId, id, body) {
    assertMember(memberId);
    const expected = revision(body);
    if (Object.keys(body).some((key) => key !== "expectedRevision"))
      throw new HttpError(422, "Submit only the saved-address revision for removal.");
    return atomic(() => {
      assertMember(memberId);
      const previous = owned(memberId, id);
      if (previous.revision !== expected)
        throw new HttpError(409, "This saved address changed. Refresh it before removing it.");
      const result = db.prepare("DELETE FROM member_addresses WHERE member_id=? AND id=? AND revision=?")
        .run(memberId, id, expected);
      if (result.changes !== 1)
        throw new HttpError(409, "This saved address changed. Refresh it before removing it.");
      return { ok: true };
    });
  }

  function ordinaryDelivery(canonical) {
    if (!record(canonical) || canonical.fulfillment !== "delivery" ||
        !Array.isArray(canonical.items) || !canonical.items.length) return false;
    return canonical.items.every((line) => {
      if (!record(line) || line.category !== "Accessories") return false;
      const id = line.productId || line.id;
      if (typeof id !== "string" || !id.length || id.length > 96 ||
          (line.productId && line.id && line.productId !== line.id)) return false;
      let product;
      try { product = JSON.parse(currentProduct.get(id)?.product_json || "null"); }
      catch { return false; }
      return record(product) && product.category === "Accessories";
    });
  }

  function rememberDelivery(memberId, canonical) {
    assertMember(memberId);
    if (!ordinaryDelivery(canonical)) return { saved: false };
    return atomic(() => {
      assertMember(memberId);
      const labels = new Set(rows.all(memberId).map((row) => normalize(row.label)));
      const nextLabel = [1, 2, 3].map((number) => "Delivery address " + number)
        .find((label) => !labels.has(normalize(label))) || "Delivery address";
      const customer = record(canonical.customer) ? canonical.customer : {};
      const value = validate({ label: nextLabel, address: customer.address, city: customer.city, postcode: customer.postcode });
      const existing = matchingAddress.get(memberId, addressKey(value));
      if (existing) {
        db.prepare("UPDATE member_addresses SET last_used_at=? WHERE member_id=? AND id=?")
          .run(timestamp(), memberId, existing.id);
        return { saved: true, addressId: existing.id };
      }
      const saved = createRow(memberId, value, timestamp());
      return { saved: true, addressId: saved.id };
    });
  }

  return { list, create, update, remove, rememberDelivery };
}
