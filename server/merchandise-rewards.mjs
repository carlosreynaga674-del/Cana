import { createHash, randomUUID } from "node:crypto";
import { normalizeMembershipNumber, MEMBERSHIP_NUMBER_PATTERN, LEGACY_MEMBERSHIP_NUMBER_PATTERN } from "../src/lib/membership.js";

const SPEND_STEP = 100_000;
const REWARD_STEP = 1_000;
const MAX_PRICE = 100_000_000;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const safeAmount = (value) => Number.isSafeInteger(value) && value >= 0;
const digest = (value) => createHash("sha256").update(value).digest("hex");

/** Nontransferable merchandise credit. A completed record never proves payment. */
export function createMerchandiseRewards({ db, HttpError, now = Date.now } = {}) {
  if (!db || typeof HttpError !== "function") throw new TypeError("A database and HTTP error type are required.");
  db.exec(
    "CREATE TABLE IF NOT EXISTS merchandise_reward_accounts (" +
      "member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE," +
      "paid_spend_cents INTEGER NOT NULL DEFAULT 0 CHECK(paid_spend_cents>=0)," +
      "earned_cents INTEGER NOT NULL DEFAULT 0 CHECK(earned_cents>=0)," +
      "redeemed_cents INTEGER NOT NULL DEFAULT 0 CHECK(redeemed_cents>=0)," +
      "balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(balance_cents>=0)," +
      "updated_at TEXT NOT NULL);" +
    "CREATE TABLE IF NOT EXISTS merchandise_reward_receipts (" +
      "order_id TEXT PRIMARY KEY," +
      "member_id TEXT REFERENCES members(id) ON DELETE SET NULL," +
      "eligible_cents INTEGER NOT NULL,redeem_cents INTEGER NOT NULL," +
      "external_paid_cents INTEGER NOT NULL,earned_cents INTEGER NOT NULL," +
      "confirmed_at TEXT NOT NULL,actor_ref TEXT NOT NULL,actor_name TEXT NOT NULL);" +
    "CREATE INDEX IF NOT EXISTS merchandise_reward_receipt_member ON merchandise_reward_receipts(member_id);" +
    "CREATE TABLE IF NOT EXISTS merchandise_reward_ledger (" +
      "sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE," +
      "member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE," +
      "order_id TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('earned','redeemed'))," +
      "amount_cents INTEGER NOT NULL CHECK(amount_cents>0),created_at TEXT NOT NULL);" +
    "CREATE INDEX IF NOT EXISTS merchandise_reward_history ON merchandise_reward_ledger(member_id,sequence DESC);",
  );
  const memberById = db.prepare("SELECT id FROM members WHERE id=?");
  const numberByMember = db.prepare("SELECT number FROM member_numbers WHERE member_id=?");
  const memberByNumber = db.prepare("SELECT m.id FROM members m JOIN member_number_aliases a ON a.member_id=m.id WHERE a.number=?");
  const accountByMember = db.prepare("SELECT * FROM merchandise_reward_accounts WHERE member_id=?");
  const receiptByOrder = db.prepare("SELECT * FROM merchandise_reward_receipts WHERE order_id=?");
  const orderById = db.prepare("SELECT id,status,items_json,totals_json FROM orders WHERE id=?");
  const productById = db.prepare("SELECT product_json FROM catalog_products WHERE id=?");
  const stamp = () => new Date(now()).toISOString();

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
    if (typeof memberId !== "string" || !memberById.get(memberId)) throw new HttpError(404, "Member not found.");
  }
  function assertOrderId(orderId) {
    if (typeof orderId !== "string" || !/^LC-[A-Z0-9]{1,64}$/.test(orderId))
      throw new HttpError(422, "Choose a valid processed merchandise record.");
  }
  function account(memberId) {
    return accountByMember.get(memberId) || {
      paid_spend_cents: 0, earned_cents: 0, redeemed_cents: 0, balance_cents: 0,
    };
  }
  function balance(memberId) {
    assertMember(memberId);
    const row = account(memberId);
    return {
      balanceCents: row.balance_cents,
      eligiblePaidSpendCents: row.paid_spend_cents,
      totalEarnedCents: row.earned_cents,
      totalRedeemedCents: row.redeemed_cents,
      progressCents: row.paid_spend_cents % SPEND_STEP,
      nextRewardAtCents: SPEND_STEP,
      rewardCents: REWARD_STEP,
      history: db.prepare("SELECT id,type,amount_cents,created_at,order_id FROM merchandise_reward_ledger WHERE member_id=? ORDER BY sequence DESC LIMIT 20")
        .all(memberId).map((entry) => ({
          id: entry.id, type: entry.type, amountCents: entry.amount_cents,
          createdAt: entry.created_at, orderId: entry.order_id,
        })),
    };
  }
  function safeReceipt(row) {
    return {
      orderId: row.order_id,
      membershipNumber: row.member_id ? numberByMember.get(row.member_id)?.number || null : null,
      eligibleMerchandiseCents: row.eligible_cents,
      externalPaidCents: row.external_paid_cents,
      redeemedCents: row.redeem_cents,
      earnedCents: row.earned_cents,
      confirmedAt: row.confirmed_at,
      confirmedBy: row.actor_name,
    };
  }
  function eligibleAmount(orderId) {
    assertOrderId(orderId);
    const row = orderById.get(orderId);
    if (!row) throw new HttpError(404, "Processed merchandise record not found.");
    if (!["completed", "delivered"].includes(row.status))
      throw new HttpError(409, "Complete the merchandise record before confirming its payment.");
    let items, totals;
    try { items = JSON.parse(row.items_json); totals = JSON.parse(row.totals_json); }
    catch { throw new HttpError(422, "This record has unreadable merchandise amounts."); }
    if (!Array.isArray(items) || !items.length || items.length > 20 || !record(totals) ||
        !safeAmount(totals.subtotal) || !safeAmount(totals.discount) ||
        totals.subtotal < 1 || totals.discount > totals.subtotal)
      throw new HttpError(422, "This record has invalid merchandise amounts.");
    let subtotal = 0, merchandise = 0;
    const seen = new Set();
    for (const item of items) {
      const productId = item?.productId || item?.id;
      if (!record(item) || typeof productId !== "string" || !productId.length || productId.length > 96 ||
          !Number.isSafeInteger(item.price) || item.price < 1 || item.price > MAX_PRICE ||
          !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 ||
          (item.productId && item.id && item.productId !== item.id) ||
          (item.sizeIndex !== undefined && (!Number.isInteger(item.sizeIndex) || item.sizeIndex < 0 || item.sizeIndex > 11)))
        throw new HttpError(422, "This record has an invalid merchandise line.");
      const lineKey = productId + ":" + String(item.sizeIndex ?? item.size ?? "");
      if (seen.has(lineKey)) throw new HttpError(422, "This record has duplicate merchandise lines.");
      seen.add(lineKey);
      const lineAmount = item.price * item.quantity;
      subtotal += lineAmount;
      if (!Number.isSafeInteger(subtotal)) throw new HttpError(422, "This merchandise amount is too large.");
      let product;
      try { product = JSON.parse(productById.get(productId)?.product_json || "null"); } catch { product = null; }
      if (item.category === "Accessories" && product?.category === "Accessories") merchandise += lineAmount;
    }
    if (subtotal !== totals.subtotal)
      throw new HttpError(422, "The saved merchandise amounts do not match this record.");
    // Exclude all other products and charges. Round down to avoid crediting a
    // fraction of a cent when the original discount spans several categories.
    const eligible = Number(BigInt(merchandise) * BigInt(subtotal - totals.discount) / BigInt(subtotal));
    if (!safeAmount(eligible) || eligible < 1)
      throw new HttpError(409, "This record has no eligible paid merchandise.");
    return eligible;
  }
  function quote(orderId) {
    const eligible = eligibleAmount(orderId);
    const existing = receiptByOrder.get(orderId);
    return {
      orderId, eligibleMerchandiseCents: eligible, paymentRecorded: Boolean(existing),
      recordedMemberNumber: existing?.member_id ? numberByMember.get(existing.member_id)?.number || null : null,
      receipt: existing ? safeReceipt(existing) : null,
    };
  }
  function confirmPayment(body, actor) {
    if (!record(actor) || actor.role !== "admin" || typeof actor.id !== "string" ||
        !actor.id.length || actor.id.length > 128 || typeof actor.name !== "string" ||
        !actor.name.trim() || actor.name.length > 120 || /[\u0000-\u001f\u007f]/.test(actor.name))
      throw new HttpError(403, "An authenticated administrator must confirm merchandise payment.");
    const fields = ["orderId", "membershipNumber", "confirmedPaid", "redeemCents", "expectedEligibleMerchandiseCents"];
    if (!record(body) || Object.keys(body).some((key) => !fields.includes(key)) ||
        body.confirmedPaid !== true || typeof body.membershipNumber !== "string" ||
        body.membershipNumber.length > 80 || !safeAmount(body.expectedEligibleMerchandiseCents) ||
        body.expectedEligibleMerchandiseCents < 1 ||
        (body.redeemCents !== undefined && !safeAmount(body.redeemCents)))
      throw new HttpError(422, "Confirm the eligible paid merchandise and member account.");
    assertOrderId(body.orderId);
    const number = normalizeMembershipNumber(body.membershipNumber);
    if (!MEMBERSHIP_NUMBER_PATTERN.test(number) && !LEGACY_MEMBERSHIP_NUMBER_PATTERN.test(number))
      throw new HttpError(422, "Enter a valid membership number.");
    const redeemCents = body.redeemCents ?? 0;
    return atomic(() => {
      const member = memberByNumber.get(number);
      if (!member) throw new HttpError(404, "Member not found.");
      const existing = receiptByOrder.get(body.orderId);
      if (existing) {
        if (existing.member_id !== member.id || existing.redeem_cents !== redeemCents ||
            existing.eligible_cents !== body.expectedEligibleMerchandiseCents)
          throw new HttpError(409, "Merchandise payment was already confirmed with different details.");
        return { receipt: safeReceipt(existing), balance: balance(member.id), idempotent: true };
      }
      const eligible = eligibleAmount(body.orderId);
      if (body.expectedEligibleMerchandiseCents !== eligible)
        throw new HttpError(409, "The eligible merchandise amount changed. Refresh before confirming payment.");
      const previous = account(member.id);
      if (redeemCents > eligible || redeemCents > previous.balance_cents)
        throw new HttpError(422, "Applied merchandise credit must not exceed the available balance or eligible amount.");
      const externalPaid = eligible - redeemCents;
      const paidSpend = previous.paid_spend_cents + externalPaid;
      if (!safeAmount(paidSpend)) throw new HttpError(422, "The merchandise account amount is too large.");
      const totalEarned = Number(BigInt(paidSpend) / BigInt(SPEND_STEP) * BigInt(REWARD_STEP));
      const earned = totalEarned - previous.earned_cents;
      const newBalance = previous.balance_cents - redeemCents + earned;
      const totalRedeemed = previous.redeemed_cents + redeemCents;
      if (!safeAmount(earned) || !safeAmount(newBalance) || !safeAmount(totalRedeemed))
        throw new HttpError(409, "The merchandise account needs an administrator review.");
      const timestamp = stamp();
      db.prepare("INSERT INTO merchandise_reward_accounts (member_id,paid_spend_cents,earned_cents,redeemed_cents,balance_cents,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET paid_spend_cents=excluded.paid_spend_cents,earned_cents=excluded.earned_cents,redeemed_cents=excluded.redeemed_cents,balance_cents=excluded.balance_cents,updated_at=excluded.updated_at")
        .run(member.id, paidSpend, totalEarned, totalRedeemed, newBalance, timestamp);
      db.prepare("INSERT INTO merchandise_reward_receipts (order_id,member_id,eligible_cents,redeem_cents,external_paid_cents,earned_cents,confirmed_at,actor_ref,actor_name) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(body.orderId, member.id, eligible, redeemCents, externalPaid, earned, timestamp,
          digest(actor.role + ":" + actor.id), actor.name.trim());
      const insertLedger = db.prepare("INSERT INTO merchandise_reward_ledger (id,member_id,order_id,type,amount_cents,created_at) VALUES (?,?,?,?,?,?)");
      if (redeemCents) insertLedger.run(randomUUID(), member.id, body.orderId, "redeemed", redeemCents, timestamp);
      if (earned) insertLedger.run(randomUUID(), member.id, body.orderId, "earned", earned, timestamp);
      return { receipt: safeReceipt(receiptByOrder.get(body.orderId)), balance: balance(member.id), idempotent: false };
    });
  }
  return { balance, quote, confirmPayment };
}
