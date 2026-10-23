import test from "node:test";
import assert from "node:assert/strict";
import { products } from "../src/lib/products.js";
import { calculateTotals } from "../src/lib/order.js";
import {
  cleanCart,
  cleanFavorites,
  cleanLocation,
  cleanOrders,
  toOrderItems,
} from "../src/lib/storage.js";

const flower = products.find((product) => product.id === "sunset-sherbet");
const drink = products.find((product) => product.id === "sunday-citrus");

function savedOrder(overrides = {}) {
  const items = cleanCart([{ id: flower.id, size: flower.size, quantity: 1 }]);
  return {
    id: "LC-TEST1234",
    createdAt: "2026-10-22T12:00:00.000Z",
    currency: "ZAR",
    items,
    totals: calculateTotals(items),
    mode: "delivery",
    customer: { name: "Jordan Demo", city: "Johannesburg", postcode: "2001" },
    status: "confirmed",
    ...overrides,
  };
}

test("restored carts use current catalog prices and product details", () => {
  const [restored] = cleanCart([
    {
      id: flower.id,
      size: "7 g",
      quantity: 2,
      price: -100,
      name: "Tampered product",
      visual: "missing-image",
      lineId: "fake-line",
    },
  ]);

  assert.equal(restored.name, flower.name);
  assert.equal(restored.price, flower.sizes[1].price);
  assert.equal(restored.visual, flower.visual);
  assert.equal(restored.quantity, 2);
  assert.equal(calculateTotals([restored]).subtotal, flower.sizes[1].price * 2);
  assert.deepEqual(toOrderItems([restored]), [
    { productId: flower.id, sizeIndex: 1, quantity: 2 },
  ]);
});

test("unknown variants recover to the base product and API selections remain correct", () => {
  const cart = cleanCart([
    { id: flower.id, size: "not-a-size", quantity: 1 },
    { id: drink.id, size: drink.size, quantity: 3 },
  ]);
  assert.equal(cart[0].size, flower.size);
  assert.equal(cart[0].price, flower.price);
  assert.deepEqual(toOrderItems(cart), [
    { productId: flower.id, sizeIndex: 0, quantity: 1 },
    { productId: drink.id, sizeIndex: 0, quantity: 3 },
  ]);
});

test("malformed cart storage, unavailable products, and unsafe quantities cannot enter a basket", () => {
  for (const value of [null, undefined, false, "[]", {}, 12]) {
    assert.deepEqual(cleanCart(value), []);
  }
  const cart = cleanCart([
    null,
    false,
    { id: "unknown-product", quantity: 1 },
    ...[0, -1, 1.5, "2", Number.POSITIVE_INFINITY].map((quantity) => ({
      id: flower.id,
      quantity,
    })),
    { id: drink.id, quantity: 1 },
  ]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].id, drink.id);
});

test("duplicate saved lines merge without exceeding the basket quantity limit", () => {
  const cart = cleanCart([
    { id: flower.id, size: "3.5 g", quantity: 12 },
    { id: flower.id, size: "3.5 g", quantity: 15 },
    { id: flower.id, size: "7 g", quantity: 1 },
  ]);
  assert.equal(cart.length, 2);
  assert.equal(cart.find((item) => item.size === "3.5 g").quantity, 20);
  assert.equal(cart.find((item) => item.size === "7 g").quantity, 1);
});

test("favorites retain only unique product identities from the current catalog", () => {
  assert.deepEqual(
    cleanFavorites([
      flower.id,
      null,
      {},
      "removed-product",
      flower.id,
      drink.id,
    ]),
    [flower.id, drink.id],
  );
  assert.deepEqual(cleanFavorites({ id: flower.id }), []);
});

test("live catalog restoration retains staff-created products, updates prices and removes withdrawn lines", () => {
  const custom = { ...drink, id: "staff-added-drink", name: "Current name", price: 9900 };
  const currentFlower = { ...flower, sizes: [{ label: "3.5 g", price: 37000 }] };
  const cart = cleanCart([
    { id: custom.id, size: custom.size, quantity: 2, price: 1, name: "Stale name" },
    { id: flower.id, size: "3.5 g", quantity: 1, price: 32000 },
    { id: drink.id, size: drink.size, quantity: 1 },
  ], [custom, currentFlower]);
  assert.equal(cart.length, 2);
  assert.equal(cart[0].name, "Current name");
  assert.equal(cart[0].price, 9900);
  assert.equal(cart[1].price, 37000);
  assert.deepEqual(cleanCart(cart, []), []);
  assert.deepEqual(toOrderItems(cart), [
    { productId: custom.id, sizeIndex: 0, quantity: 2 },
    { productId: flower.id, sizeIndex: 0, quantity: 1 },
  ]);
});

test("safe favourite references survive loading while visible picks use the live catalog", () => {
  const custom = { ...drink, id: "staff-added-drink" };
  const references = cleanFavorites([custom.id, "temporarily-draft", custom.id, "<script>", null], null);
  assert.deepEqual(references, [custom.id, "temporarily-draft"]);
  assert.deepEqual(cleanFavorites(references, [custom]), [custom.id]);
});

test("server-backed history preserves product snapshots after a product is withdrawn", () => {
  const archivedSnapshot = { ...savedOrder().items[0], id: "withdrawn-staff-product", name: "Historical product", price: 12500 };
  const order = savedOrder({ items: [archivedSnapshot] });
  assert.deepEqual(cleanOrders([order]), [order]);
});

test("delivery-area storage keeps four-digit postal codes and accepts only an explicit pickup mode", () => {
  assert.deepEqual(
    cleanLocation({
      postcode: "0002",
      mode: "pickup",
      address: "123 Demo Street",
    }),
    {
      postcode: "0002",
      mode: "pickup",
      address: "123 Demo Street",
    },
  );
  for (const value of [
    null,
    {},
    { postcode: 2001, mode: true },
    { postcode: "20010", mode: "PICKUP" },
  ]) {
    assert.deepEqual(cleanLocation(value), {
      postcode: "",
      address: "",
      mode: "delivery",
    });
  }
});

test("saved-order history rejects incompatible or malformed orders before rendering tracking", () => {
  const valid = savedOrder();
  const invalid = [
    null,
    {},
    savedOrder({ currency: "USD" }),
    savedOrder({ id: "not-an-order-id" }),
    savedOrder({ createdAt: "not-a-date" }),
    savedOrder({ customer: { name: null } }),
    savedOrder({ items: [] }),
    savedOrder({ items: [null] }),
    savedOrder({ items: [{ ...valid.items[0], quantity: -1 }] }),
    savedOrder({ totals: { ...valid.totals, total: Number.NaN } }),
  ];
  assert.deepEqual(cleanOrders([...invalid, valid]), [valid]);
  assert.deepEqual(cleanOrders({}), []);
  assert.equal(
    cleanOrders(
      Array.from({ length: 12 }, (_, index) =>
        savedOrder({ id: `LC-TEST${index}` }),
      ),
    ).length,
    10,
  );
});
