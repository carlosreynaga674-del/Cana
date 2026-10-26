import { createHash } from "node:crypto";

const FIELDS = ["bankName", "accountHolder", "accountNumber", "branchCode", "accountType", "reference", "instructions"];
const TYPES = ["current", "savings", "business"];
const EMPTY = { bankName: "", accountHolder: "", accountNumber: "", branchCode: "", accountType: "current", reference: "", instructions: "" };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const controls = /[\u0000-\u001f\u007f]/;
const noteControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Private administrator records for ordinary merchandise; never a checkout API. */
export function createMerchandisePaymentDetails({ db, HttpError, now = Date.now }) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS merchandise_payment_settings (" +
      "id INTEGER PRIMARY KEY CHECK(id=1),details_json TEXT NOT NULL," +
      "revision INTEGER NOT NULL,updated_at TEXT);" +
    "CREATE TABLE IF NOT EXISTS merchandise_payment_audit (" +
      "revision INTEGER PRIMARY KEY,actor_ref TEXT NOT NULL,updated_at TEXT NOT NULL);",
  );
  db.prepare("INSERT INTO merchandise_payment_settings (id,details_json,revision,updated_at) VALUES (1,?,1,NULL) ON CONFLICT(id) DO NOTHING")
    .run(JSON.stringify(EMPTY));
  const current = db.prepare("SELECT details_json,revision,updated_at FROM merchandise_payment_settings WHERE id=1");

  function validate(value) {
    if (!record(value) || Object.keys(value).some((key) => !FIELDS.includes(key)))
      throw new HttpError(422, "Submit only the supported merchandise bank details.");
    const errors = {};
    const details = {};
    for (const [key, min, max, multiline] of [
      ["bankName", 2, 80, false], ["accountHolder", 2, 120, false],
      ["accountNumber", 6, 20, false], ["branchCode", 6, 6, false],
      ["accountType", 1, 20, false], ["reference", 0, 80, false],
      ["instructions", 0, 1000, true],
    ]) {
      const raw = value[key] === undefined && ["reference", "instructions"].includes(key) ? "" : value[key];
      const text = typeof raw === "string" ? raw.trim() : "";
      if (typeof raw !== "string" || text.length < min || text.length > max || (multiline ? noteControls : controls).test(raw))
        errors[key] = "Enter a valid value within the displayed length limit.";
      details[key] = text;
    }
    if (!/^\d{6,20}$/.test(details.accountNumber))
      errors.accountNumber = "Enter 6–20 digits, including any leading zeros.";
    if (!/^\d{6}$/.test(details.branchCode))
      errors.branchCode = "Enter the six-digit branch code.";
    if (!TYPES.includes(details.accountType))
      errors.accountType = "Choose a current, savings or business account.";
    if (Object.keys(errors).length)
      throw new HttpError(422, "Please check the merchandise payment details.", errors);
    return details;
  }

  function get() {
    const row = current.get();
    let details;
    try { details = JSON.parse(row.details_json); }
    catch { throw new HttpError(503, "Payment details could not be read. Contact the administrator."); }
    const empty = record(details) && FIELDS.every((key) => details[key] === EMPTY[key]) &&
      Object.keys(details).length === FIELDS.length;
    if (!empty) {
      try { details = validate(details); }
      catch { throw new HttpError(503, "Payment details could not be read. Contact the administrator."); }
    }
    return {
      details, revision: row.revision, updatedAt: row.updated_at,
      configured: !empty, scope: "non_cannabis_merchandise",
    };
  }

  function update(body, actor) {
    if (!record(actor) || actor.role !== "admin" || typeof actor.id !== "string" ||
        !actor.id.length || actor.id.length > 128 || controls.test(actor.id))
      throw new HttpError(403, "Only the administrator can update merchandise payment details.");
    if (!record(body) || Object.keys(body).some((key) => !["details", "expectedRevision"].includes(key)) ||
        !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1)
      throw new HttpError(422, "Include the current payment-details revision before saving.");
    const details = validate(body.details);
    const timestamp = new Date(now()).toISOString();
    const ownTransaction = !db.isTransaction;
    if (ownTransaction) db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare("UPDATE merchandise_payment_settings SET details_json=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?")
        .run(JSON.stringify(details), timestamp, body.expectedRevision);
      if (result.changes !== 1)
        throw new HttpError(409, "These payment details changed in another session. Review the latest saved details before saving.");
      db.prepare("INSERT INTO merchandise_payment_audit (revision,actor_ref,updated_at) VALUES (?,?,?)")
        .run(body.expectedRevision + 1, createHash("sha256").update(actor.role + ":" + actor.id).digest("hex"), timestamp);
      const resultSettings = get();
      if (ownTransaction) db.exec("COMMIT");
      return resultSettings;
    } catch (error) {
      if (ownTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
  return { get, update };
}
