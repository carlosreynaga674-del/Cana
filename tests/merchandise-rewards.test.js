import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMerchandiseRewards } from "../server/merchandise-rewards.mjs";
import { createMemberNumbers } from "../server/member-numbers.mjs";

// Isolated bookkeeping fixtures only. No real purchases, payments or mail.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const status = (expected) => (error) => error instanceof HttpError && error.status === expected;
const ADMIN = { id: "local-admin", name: "Local Administrator", username: "local.admin", role: "admin" };
const secretEmail = "private-local-member@example.test";

function schema(db) {
  db.exec(
    "PRAGMA foreign_keys=ON;" +
    "CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,name TEXT,email TEXT);" +
    "CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,status TEXT,items_json TEXT,totals_json TEXT);" +
    "CREATE TABLE IF NOT EXISTS catalog_products(id TEXT PRIMARY KEY,product_json TEXT,status TEXT);",
  );
}
function fixture(t, { filename = ":memory:" } = {}) {
  const db = new DatabaseSync(filename);
  schema(db);
  const numbers = createMemberNumbers({ db, HttpError });
  const rewards = createMerchandiseRewards({ db, HttpError, now: () => Date.parse("2026-10-25T12:00:00Z") });
  t.after(() => db.close());
  const addMember = () => {
    const id = randomUUID();
    db.prepare("INSERT INTO members VALUES (?,?,?)").run(id, "Local Private Member", secretEmail);
    return { id, number: numbers.assign(id) };
  };
  const product = (id, category = "Accessories", extra = {}) => {
    db.prepare("INSERT INTO catalog_products VALUES (?,?,'published') ON CONFLICT(id) DO UPDATE SET product_json=excluded.product_json")
      .run(id, JSON.stringify({ id, name: "Local " + id, category, ...extra }));
  };
  product("ordinary-jar"); product("ordinary-bag"); product("restricted-fixture", "Flower");
  const item = (productId, price, quantity = 1, category = productId === "restricted-fixture" ? "Flower" : "Accessories") => ({
    id: productId, productId, name: "Local line", sizeIndex: 0, size: "Standard", category, price, quantity,
  });
  const addOrder = (items, { discount = 0, state = "completed", deliveryFee = 4900, totals: override } = {}) => {
    const id = "LC-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    const subtotal = items.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const totals = override || { subtotal, discount, deliveryFee, serviceFee: 0, total: subtotal - discount + deliveryFee };
    db.prepare("INSERT INTO orders VALUES (?,?,?,?)").run(id, state, JSON.stringify(items), JSON.stringify(totals));
    return id;
  };
  const confirm = (orderId, member, extra = {}, actor = ADMIN) => rewards.confirmPayment({
    orderId, membershipNumber: member.number, confirmedPaid: true,
    expectedEligibleMerchandiseCents: rewards.quote(orderId).eligibleMerchandiseCents,
    ...extra,
  }, actor);
  return { db, rewards, numbers, addMember, product, item, addOrder, confirm };
}

test("merchandise quotes require both current and historical eligibility, exclude charges and allocate discounts exactly", (t) => {
  const f = fixture(t);
  const order = f.addOrder([
    f.item("ordinary-jar", 50000), f.item("ordinary-bag", 50000), f.item("restricted-fixture", 100000),
  ], { discount: 30000, deliveryFee: 999999 });
  assert.equal(f.rewards.quote(order).eligibleMerchandiseCents, 85000);
  f.product("ordinary-bag", "Flower");
  assert.equal(f.rewards.quote(order).eligibleMerchandiseCents, 42500);
  const dishonestSnapshot = f.addOrder([f.item("restricted-fixture", 100000, 1, "Accessories")]);
  assert.throws(() => f.rewards.quote(dishonestSnapshot), status(409));
  const changedCategory = f.addOrder([f.item("ordinary-jar", 100000, 1, "Flower")]);
  assert.throws(() => f.rewards.quote(changedCategory), status(409));
  const pending = f.addOrder([f.item("ordinary-jar", 100000)], { state: "pending" });
  assert.throws(() => f.rewards.quote(pending), status(409));
  const invalid = f.addOrder([f.item("ordinary-jar", 100000)], { totals: { subtotal: 100001, discount: 0 } });
  assert.throws(() => f.rewards.quote(invalid), status(422));
  const fractional = f.addOrder([f.item("ordinary-jar", 2), f.item("restricted-fixture", 1)], { discount: 1 });
  assert.equal(f.rewards.quote(fractional).eligibleMerchandiseCents, 1);
});

test("only administrator-confirmed paid spend earns cumulative R10 credit for each R1000 threshold", (t) => {
  const f = fixture(t);
  const member = f.addMember();
  const first = f.addOrder([f.item("ordinary-jar", 50000)]);
  assert.deepEqual(f.rewards.balance(member.id), {
    balanceCents: 0, eligiblePaidSpendCents: 0, totalEarnedCents: 0, totalRedeemedCents: 0,
    progressCents: 0, nextRewardAtCents: 100000, rewardCents: 1000, history: [],
  });
  assert.equal(f.rewards.quote(first).paymentRecorded, false);
  assert.throws(() => f.confirm(first, member, { confirmedPaid: false }), status(422));
  assert.throws(() => f.confirm(first, member, {}, { ...ADMIN, role: "staff" }), status(403));
  const one = f.confirm(first, member);
  assert.equal(one.receipt.earnedCents, 0);
  assert.equal(one.balance.progressCents, 50000);
  const second = f.addOrder([f.item("ordinary-jar", 49999)]);
  assert.equal(f.confirm(second, member).balance.totalEarnedCents, 0);
  const third = f.addOrder([f.item("ordinary-jar", 1)]);
  const reached = f.confirm(third, member);
  assert.equal(reached.receipt.earnedCents, 1000);
  assert.equal(reached.balance.balanceCents, 1000);
  assert.equal(reached.balance.eligiblePaidSpendCents, 100000);
  assert.equal(reached.balance.progressCents, 0);
  const large = f.addOrder([f.item("ordinary-bag", 250000)]);
  const later = f.confirm(large, member);
  assert.equal(later.receipt.earnedCents, 2000);
  assert.equal(later.balance.balanceCents, 3000);
  assert.equal(later.balance.progressCents, 50000);
});

test("credit redemption cannot exceed eligible merchandise or balance and never earns credit on itself", (t) => {
  const f = fixture(t);
  const member = f.addMember();
  f.confirm(f.addOrder([f.item("ordinary-jar", 100000)]), member);
  const next = f.addOrder([f.item("ordinary-bag", 1000)]);
  for (const redeemCents of [-1, 0.5, 1001, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => f.confirm(next, member, { redeemCents }), status(422));
  const fullCredit = f.confirm(next, member, { redeemCents: 1000 });
  assert.equal(fullCredit.receipt.externalPaidCents, 0);
  assert.equal(fullCredit.receipt.redeemedCents, 1000);
  assert.equal(fullCredit.receipt.earnedCents, 0);
  assert.equal(fullCredit.balance.balanceCents, 0);
  assert.equal(fullCredit.balance.eligiblePaidSpendCents, 100000);
  assert.equal(fullCredit.balance.totalRedeemedCents, 1000);
  const noBalance = f.addOrder([f.item("ordinary-jar", 1000)]);
  assert.throws(() => f.confirm(noBalance, member, { redeemCents: 1 }), status(422));
  const awarded = f.confirm(noBalance, member);
  assert.equal(awarded.balance.balanceCents, 0);
  assert.equal(awarded.balance.eligiblePaidSpendCents, 101000);
});

test("confirmation is idempotent by record, including aliases, and conflicting retries cannot credit a different member", (t) => {
  const f = fixture(t);
  const member = f.addMember(), another = f.addMember();
  const oldAlias = "LC-0123-ABCD-WXYZ";
  f.db.prepare("INSERT INTO member_number_aliases VALUES (?,?)").run(oldAlias, member.id);
  const order = f.addOrder([f.item("ordinary-jar", 100000)]);
  const first = f.confirm(order, member);
  const repeated = f.confirm(order, { ...member, number: oldAlias });
  assert.equal(repeated.idempotent, true);
  assert.deepEqual(repeated.receipt, first.receipt);
  assert.equal(f.rewards.balance(member.id).balanceCents, 1000);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM merchandise_reward_receipts").get().count, 1);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM merchandise_reward_ledger").get().count, 1);
  assert.throws(() => f.confirm(order, another), status(409));
  assert.throws(() => f.confirm(order, member, { redeemCents: 1 }), status(409));
  assert.throws(() => f.confirm(order, member, { expectedEligibleMerchandiseCents: 99999 }), status(409));
  const secondStore = createMerchandiseRewards({ db: f.db, HttpError });
  const again = secondStore.confirmPayment({
    orderId: order, membershipNumber: member.number, confirmedPaid: true,
    expectedEligibleMerchandiseCents: 100000,
  }, ADMIN);
  assert.equal(again.idempotent, true);
  assert.equal(again.balance.balanceCents, 1000);
});

test("stale amounts and forged financial fields fail closed without changing account data", (t) => {
  const f = fixture(t);
  const member = f.addMember();
  const order = f.addOrder([f.item("ordinary-jar", 50000), f.item("ordinary-bag", 50000)]);
  const originalAmount = f.rewards.quote(order).eligibleMerchandiseCents;
  f.product("ordinary-bag", "Flower");
  assert.throws(() => f.confirm(order, member, { expectedEligibleMerchandiseCents: originalAmount }), status(409));
  for (const extra of [{ paidCents: 100000 }, { memberId: member.id }, { role: "admin" }, { products: ["ordinary-jar"] }, { actor: ADMIN }])
    assert.throws(() => f.confirm(order, member, extra), status(422));
  assert.equal(f.rewards.balance(member.id).balanceCents, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM merchandise_reward_receipts").get().count, 0);
  assert.throws(() => f.rewards.quote("https://unrelated.example.test"), status(422));
  assert.throws(() => f.rewards.balance("missing-member"), status(404));
});

test("receipt, accumulated spend and earned/redeemed ledger changes roll back together", (t) => {
  const f = fixture(t);
  const member = f.addMember();
  const order = f.addOrder([f.item("ordinary-jar", 100000)]);
  f.db.exec("BEGIN IMMEDIATE");
  f.confirm(order, member);
  assert.equal(f.rewards.balance(member.id).balanceCents, 1000);
  f.db.exec("ROLLBACK");
  assert.equal(f.rewards.balance(member.id).balanceCents, 0);
  assert.equal(f.rewards.quote(order).paymentRecorded, false);
  f.db.exec("CREATE TRIGGER fail_reward_ledger BEFORE INSERT ON merchandise_reward_ledger BEGIN SELECT RAISE(ABORT,'local reward persistence failure'); END;");
  assert.throws(() => f.confirm(order, member), /local reward persistence failure/);
  assert.equal(f.rewards.quote(order).paymentRecorded, false);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM merchandise_reward_accounts").get().count, 0);
  f.db.exec("DROP TRIGGER fail_reward_ledger");
  assert.equal(f.confirm(order, member).balance.balanceCents, 1000);
});

test("deleted member accounts remove balances/history but retain an unlinked receipt reservation", (t) => {
  const f = fixture(t);
  const member = f.addMember();
  const order = f.addOrder([f.item("ordinary-jar", 100000)]);
  f.confirm(order, member);
  f.db.prepare("DELETE FROM members WHERE id=?").run(member.id);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM merchandise_reward_accounts").get().count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM merchandise_reward_ledger").get().count, 0);
  const receipt = f.db.prepare("SELECT * FROM merchandise_reward_receipts WHERE order_id=?").get(order);
  assert.equal(receipt.member_id, null);
  assert.equal("membership_number" in receipt, false);
  for (const privateValue of [member.id, member.number, secretEmail, "Local Private Member"])
    assert.equal(JSON.stringify(receipt).includes(privateValue), false);
  const quote = f.rewards.quote(order);
  assert.equal(quote.recordedMemberNumber, null);
  assert.equal(quote.receipt.membershipNumber, null);
  assert.equal(quote.paymentRecorded, true);
  const replacement = f.addMember();
  assert.throws(() => f.confirm(order, replacement), status(409));
  assert.equal(f.rewards.balance(replacement.id).balanceCents, 0);
});

test("durable accounts, receipts and private history survive storage restart without backfill", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-rewards-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "rewards.sqlite");
  const db = new DatabaseSync(filename);
  schema(db);
  db.prepare("INSERT INTO members VALUES (?,?,?)").run("local-member", "Private restart name", secretEmail);
  const numbers = createMemberNumbers({ db, HttpError });
  const number = numbers.get("local-member");
  db.prepare("INSERT INTO catalog_products VALUES (?,?,'published')").run("ordinary-merch", JSON.stringify({ category: "Accessories" }));
  db.prepare("INSERT INTO orders VALUES (?,?,?,?)").run("LC-REWARDRESTART", "delivered",
    JSON.stringify([{ productId: "ordinary-merch", category: "Accessories", price: 100000, quantity: 1 }]),
    JSON.stringify({ subtotal: 100000, discount: 0, deliveryFee: 4900, total: 104900 }));
  let rewards = createMerchandiseRewards({ db, HttpError });
  assert.equal(rewards.balance("local-member").balanceCents, 0, "Historical completion does not prove payment.");
  rewards.confirmPayment({
    orderId: "LC-REWARDRESTART", membershipNumber: number, confirmedPaid: true, expectedEligibleMerchandiseCents: 100000,
  }, ADMIN);
  const before = rewards.balance("local-member");
  db.close();
  const restarted = new DatabaseSync(filename);
  restarted.exec("PRAGMA foreign_keys=ON");
  t.after(() => restarted.close());
  rewards = createMerchandiseRewards({ db: restarted, HttpError });
  assert.deepEqual(rewards.balance("local-member"), before);
  const stored = JSON.stringify(rewards.balance("local-member"));
  assert.equal(stored.includes(secretEmail), false);
  assert.equal(stored.includes("Private restart name"), false);
  assert.equal(rewards.quote("LC-REWARDRESTART").recordedMemberNumber, number);
});
