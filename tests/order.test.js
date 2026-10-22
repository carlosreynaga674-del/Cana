import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTotals,
  formatMoney,
  makeOrderId,
  validateCheckout,
} from "../src/lib/order.js";

const customer = {
  name: "Jamie Rivera",
  phone: "071 234 5678",
  email: "jamie@example.com",
  address: "123 Market Street",
  city: "Johannesburg",
  postcode: "2001",
};

test("totals reflect product quantities and delivery fee in cents", () => {
  assert.deepEqual(
    calculateTotals([
      { price: 32000, quantity: 2 },
      { price: 8000, quantity: 1 },
    ]),
    {
      subtotal: 72000,
      deliveryFee: 4900,
      serviceFee: 0,
      discount: 0,
      total: 76900,
      itemCount: 3,
    },
  );
});

test("delivery becomes free at the R750 subtotal threshold", () => {
  assert.equal(
    calculateTotals([{ price: 74999, quantity: 1 }]).deliveryFee,
    4900,
  );
  assert.equal(calculateTotals([{ price: 75000, quantity: 1 }]).deliveryFee, 0);
});

test("pickup has no delivery fee", () => {
  const result = calculateTotals([{ price: 12000, quantity: 1 }], "pickup");
  assert.equal(result.deliveryFee, 0);
  assert.equal(result.total, 12000);
});

test("LOUD15 discounts the subtotal with cent rounding, and unknown codes have no effect", () => {
  const result = calculateTotals(
    [{ price: 1295, quantity: 1 }],
    "delivery",
    " loud15 ",
  );
  assert.equal(result.discount, 194);
  assert.equal(result.total, 6001);
  assert.equal(
    calculateTotals([{ price: 1295, quantity: 1 }], "delivery", "FREEDELIVERY")
      .total,
    6195,
  );
  const thresholdOrder = calculateTotals(
    [{ price: 75000, quantity: 1 }],
    "delivery",
    "LOUD15",
  );
  assert.equal(thresholdOrder.deliveryFee, 0);
  assert.equal(thresholdOrder.discount, 11250);
  assert.equal(thresholdOrder.total, 63750);
});

test("empty cart has no fees or discount", () => {
  assert.deepEqual(calculateTotals([], "delivery", "LOUD15"), {
    subtotal: 0,
    deliveryFee: 0,
    serviceFee: 0,
    discount: 0,
    total: 0,
    itemCount: 0,
  });
});

test("valid delivery checkout passes, and all required fields are checked", () => {
  assert.deepEqual(validateCheckout(customer), {});
  assert.deepEqual(Object.keys(validateCheckout({})).sort(), [
    "address",
    "city",
    "email",
    "name",
    "phone",
    "postcode",
  ]);
});

test("pickup checkout requires contact details but no delivery address", () => {
  const { address, city, postcode, ...contact } = customer;
  assert.deepEqual(validateCheckout(contact, "pickup"), {});
  assert.ok(
    validateCheckout(
      { ...contact, email: "invalid", phone: "555", name: " " },
      "pickup",
    ).email,
  );
  assert.ok(
    validateCheckout(
      { ...contact, email: "invalid", phone: "555", name: " " },
      "pickup",
    ).phone,
  );
  assert.ok(
    validateCheckout(
      { ...contact, email: "invalid", phone: "555", name: " " },
      "pickup",
    ).name,
  );
});

test("checkout accepts South African contact details and rejects malformed postal codes and phones", () => {
  for (const postcode of ["abc", "123", "12345", "2001-1234"]) {
    assert.ok(validateCheckout({ ...customer, postcode }).postcode);
  }
  assert.deepEqual(validateCheckout({ ...customer, postcode: "0002" }), {});
  for (const phone of [
    "123",
    "071234567890",
    "+1 4155550123",
    "call 0712345678",
    "+27 0712345678",
    "0000000000",
  ]) {
    assert.ok(validateCheckout({ ...customer, phone }).phone);
  }
  assert.deepEqual(
    validateCheckout({ ...customer, phone: "+27 (71) 234-5678" }),
    {},
  );
  assert.deepEqual(
    validateCheckout({ ...customer, phone: "011 123 4567" }),
    {},
  );
});

test("currency display and order references have usable formats", () => {
  assert.equal(formatMoney(35000), "R\u00a0350,00");
  assert.match(makeOrderId(), /^LC-[A-Z0-9]{8}$/);
  assert.notEqual(makeOrderId(), makeOrderId());
});
