import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const SAST_OFFSET = 2 * 60 * 60 * 1000;
const MAX_SELECTION = 100;
const PRODUCT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clean = (value) => typeof value === "string" ? value.trim() : "";
const safeText = (value, max) => {
  const text = clean(value);
  return text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : "";
};
const productId = (value) => typeof value === "string" && value.length <= 96 && PRODUCT_ID.test(value);
const parse = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};
const localDay = (timestamp) => new Date(timestamp + SAST_OFFSET).toISOString().slice(0, 10);

/** Administrative reporting for non-cannabis merchandise, never a sales action. */
export function createProcessedReports({ db, HttpError, now = Date.now } = {}) {
  if (!db || typeof HttpError !== "function")
    throw new TypeError("A database and HTTP error type are required.");
  db.exec(
    "CREATE TABLE IF NOT EXISTS processed_report_settings (" +
      "id INTEGER PRIMARY KEY CHECK(id=1),product_ids_json TEXT NOT NULL,revision INTEGER NOT NULL);" +
    "INSERT INTO processed_report_settings (id,product_ids_json,revision) VALUES (1,'[]',1) ON CONFLICT(id) DO NOTHING;" +
    "CREATE TABLE IF NOT EXISTS processed_merchandise_events (" +
      "order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE," +
      "processed_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('completed','delivered'))," +
      "staff_name TEXT NOT NULL,staff_username TEXT NOT NULL,actor_ref TEXT NOT NULL,products_json TEXT NOT NULL);" +
    "CREATE INDEX IF NOT EXISTS processed_merchandise_events_date ON processed_merchandise_events(processed_at,order_id);" +
    "CREATE INDEX IF NOT EXISTS orders_processed_report_date ON orders(status,updated_at,id);",
  );
  const preferences = db.prepare("SELECT product_ids_json,revision FROM processed_report_settings WHERE id=1");
  const allProducts = db.prepare("SELECT id,product_json,status FROM catalog_products ORDER BY id");
  const eventByOrder = db.prepare("SELECT order_id FROM processed_merchandise_events WHERE order_id=?");
  const insertEvent = db.prepare(
    "INSERT INTO processed_merchandise_events (order_id,processed_at,status,staff_name,staff_username,actor_ref,products_json) VALUES (?,?,?,?,?,?,?)",
  );
  const reportRows = db.prepare(
    "SELECT o.id,o.status,o.items_json,e.processed_at,e.staff_name,e.staff_username,e.products_json " +
      "FROM processed_merchandise_events e JOIN orders o ON o.id=e.order_id " +
      "WHERE o.status IN ('completed','delivered') AND e.processed_at>=? AND e.processed_at<? " +
    "UNION ALL " +
    "SELECT o.id,o.status,o.items_json,o.updated_at AS processed_at,NULL AS staff_name,NULL AS staff_username,NULL AS products_json " +
      "FROM orders o WHERE o.status IN ('completed','delivered') AND o.updated_at>=? AND o.updated_at<? " +
      "AND NOT EXISTS(SELECT 1 FROM processed_merchandise_events e WHERE e.order_id=o.id) " +
    "ORDER BY processed_at DESC,id DESC",
  );

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

  function eligibleProducts() {
    const products = new Map();
    for (const row of allProducts.iterate()) {
      const data = parse(row.product_json, null);
      // Category cannot be supplied by a report request or inferred from a name.
      if (!isRecord(data) || data.category !== "Accessories" || !productId(row.id) ||
          !["draft", "published", "archived"].includes(row.status)) continue;
      const name = safeText(data.name, 120);
      if (name) products.set(row.id, { id: row.id, name, status: row.status });
    }
    return products;
  }

  function selectedIds(eligible) {
    const value = parse(preferences.get().product_ids_json, []);
    return Array.isArray(value)
      ? [...new Set(value.filter((id) => productId(id) && eligible.has(id)))].slice(0, MAX_SELECTION)
      : [];
  }

  function settings() {
    const eligible = eligibleProducts();
    return {
      products: [...eligible.values()].sort((left, right) =>
        left.name.localeCompare(right.name, "en-ZA") || left.id.localeCompare(right.id)),
      selectedProductIds: selectedIds(eligible),
      revision: preferences.get().revision,
      scope: "non_cannabis_merchandise",
    };
  }

  function saveSettings(body) {
    if (!isRecord(body) || Object.keys(body).some((key) => !["productIds", "expectedRevision"].includes(key)) ||
        !Array.isArray(body.productIds) || body.productIds.length > MAX_SELECTION ||
        body.productIds.some((id) => !productId(id)) || new Set(body.productIds).size !== body.productIds.length ||
        !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)
      throw new HttpError(422, "Choose valid merchandise products and a current report selection.");
    return atomic(() => {
      const eligible = eligibleProducts();
      if (body.productIds.some((id) => !eligible.has(id)))
        throw new HttpError(422, "Only the available non-cannabis merchandise can be included in this report.");
      const result = db.prepare(
        "UPDATE processed_report_settings SET product_ids_json=?,revision=revision+1 WHERE id=1 AND revision=?",
      ).run(JSON.stringify(body.productIds), body.expectedRevision);
      if (result.changes !== 1)
        throw new HttpError(409, "The report selection changed. Refresh it before saving again.");
      return settings();
    });
  }

  function merchandiseLines(raw, eligible) {
    const lines = parse(raw, []);
    if (!Array.isArray(lines)) return [];
    return lines.flatMap((line) => {
      if (!isRecord(line) || line.category !== "Accessories") return [];
      if ((line.productId !== undefined && typeof line.productId !== "string") ||
          (line.id !== undefined && typeof line.id !== "string")) return [];
      const id = line.productId || line.id;
      if (!productId(id) || !eligible.has(id) ||
          (line.productId && line.id && line.productId !== line.id) ||
          !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000) return [];
      const name = safeText(line.name, 120), size = safeText(line.size, 80);
      if (!name || (line.size !== undefined &&
          (typeof line.size !== "string" || clean(line.size) !== size))) return [];
      return [{ id, name, size, quantity: line.quantity }];
    });
  }

  function recordCompletion(row, actor) {
    if (!row || !["completed", "delivered"].includes(row.status)) return false;
    return atomic(() => {
      if (typeof row.id !== "string" || !row.id.length || row.id.length > 100 ||
          typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)))
        throw new HttpError(422, "A valid completed record is required.");
      if (eventByOrder.get(row.id)) return false;
      const products = merchandiseLines(row.items_json, eligibleProducts());
      if (!products.length) return false;
      if (!isRecord(actor) || !["admin", "staff"].includes(actor.role) ||
          !safeText(actor.id, 128) || !safeText(actor.name, 120) || !safeText(actor.username, 120))
        throw new HttpError(422, "A trusted workforce identity is required for attribution.");
      const sharedStaff = actor.role === "staff" && (actor.id === "legacy-staff" || actor.username === "staff");
      const staffName = sharedStaff ? "Shared staff account" : clean(actor.name);
      const actorRef = createHash("sha256").update(actor.role + ":" + actor.id).digest("hex");
      insertEvent.run(
        row.id, new Date(row.updated_at).toISOString(), row.status,
        staffName, clean(actor.username), actorRef, JSON.stringify(products),
      );
      return true;
    });
  }

  function integer(value, min, max, label) {
    if ((typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) ||
        !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)
      throw new HttpError(422, "Choose a valid report " + label + ".");
    return Number(value);
  }

  function day(value, label) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new HttpError(422, "Choose a valid " + label + " date.");
    const milliseconds = Date.parse(value + "T00:00:00.000Z");
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value)
      throw new HttpError(422, "Choose a valid " + label + " date.");
    return milliseconds;
  }

  function list(options = {}) {
    if (!isRecord(options) || Object.keys(options).some((key) => !["from", "to", "page", "limit"].includes(key)))
      throw new HttpError(422, "Choose valid report filters.");
    const to = options.to === undefined ? localDay(now()) : options.to;
    const endDay = day(to, "end");
    const from = options.from === undefined ? new Date(endDay - 29 * DAY_MS).toISOString().slice(0, 10) : options.from;
    const startDay = day(from, "start");
    if (endDay < startDay || endDay - startDay >= 366 * DAY_MS)
      throw new HttpError(422, "Choose a report date range of at most 366 days.");
    const page = integer(options.page ?? "1", 1, 1_000_000, "page");
    const limit = integer(options.limit ?? "50", 1, 100, "page size");
    const start = new Date(startDay - SAST_OFFSET).toISOString();
    const end = new Date(endDay + DAY_MS - SAST_OFFSET).toISOString();
    return atomic(() => {
      const eligible = eligibleProducts();
      const productIds = selectedIds(eligible);
      const selection = new Set(productIds);
      let total = 0, units = 0;
      const pageRows = [];
      if (selection.size) for (const row of reportRows.iterate(start, end, start, end)) {
        const timestamp = Date.parse(row.processed_at);
        if (!Number.isFinite(timestamp)) continue;
        const history = merchandiseLines(row.items_json, eligible);
        if (!history.length) continue;
        let products = history;
        const recorded = row.products_json !== null;
        if (recorded) {
          const saved = parse(row.products_json, []);
          const historyKeys = new Set(history.map((line) => line.id + "\n" + line.size));
          products = Array.isArray(saved) ? saved.filter((line) =>
            isRecord(line) && productId(line.id) && eligible.has(line.id) &&
            historyKeys.has(line.id + "\n" + line.size) &&
            safeText(line.name, 120) && typeof line.size === "string" &&
            safeText(line.size, 80) === line.size && Number.isSafeInteger(line.quantity) &&
            line.quantity >= 1 && line.quantity <= 10000,
          ).map((line) => ({ id: line.id, name: line.name, size: line.size, quantity: line.quantity })) : [];
        }
        products = products.filter((line) => selection.has(line.id));
        if (!products.length) continue;
        const index = total++;
        units += products.reduce((sum, line) => sum + line.quantity, 0);
        if (index < (page - 1) * limit || pageRows.length >= limit) continue;
        pageRows.push({
          id: row.id, processedAt: new Date(timestamp).toISOString(), status: row.status,
          staffName: recorded ? row.staff_name : "Not recorded",
          staffUsername: recorded ? row.staff_username : "",
          attribution: recorded ? "recorded" : "not_recorded",
          products,
        });
      }
      const groups = [];
      for (const row of pageRows) {
        const date = localDay(Date.parse(row.processedAt));
        if (groups.at(-1)?.date !== date) groups.push({ date, records: [] });
        groups.at(-1).records.push(row);
      }
      return {
        groups, total, page, limit, summary: { records: total, units },
        productIds, from, to, timeZone: "Africa/Johannesburg",
      };
    });
  }
  return { settings, saveSettings, recordCompletion, list };
}
