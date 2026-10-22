const currencyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
});

export function formatMoney(cents) {
  return currencyFormatter.format(cents / 100);
}

export function calculateTotals(items, mode = "delivery", promoCode = "") {
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const promo = promoCode.trim().toUpperCase();
  const discount = promo === "LOUD15" ? Math.round(subtotal * 0.15) : 0;
  const deliveryFee =
    mode === "delivery" && subtotal > 0 && subtotal < 75000 ? 4900 : 0;
  const serviceFee = 0;

  return {
    subtotal,
    deliveryFee,
    serviceFee,
    discount,
    total: subtotal - discount + deliveryFee + serviceFee,
    itemCount,
  };
}

export function validateCheckout(values, mode = "delivery") {
  const errors = {};
  if ((values.name || "").trim().length < 2)
    errors.name = "Please enter your full name.";
  const phone = (values.phone || "").trim();
  const normalizedPhone = phone.replace(/[\s().-]/g, "");
  if (!/^(?:0[1-9]\d{8}|\+27[1-9]\d{8})$/.test(normalizedPhone))
    errors.phone = "Please enter a valid South African phone number.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((values.email || "").trim())) {
    errors.email = "Please enter a valid email address.";
  }
  if (mode === "delivery") {
    if (!(values.address || "").trim())
      errors.address = "Please enter your delivery address.";
    if (!(values.city || "").trim()) errors.city = "Please enter your city.";
    if (!/^\d{4}$/.test((values.postcode || "").trim()))
      errors.postcode = "Please enter a valid 4-digit postal code.";
  }
  return errors;
}

export function makeOrderId() {
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 8)
    : Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `LC-${randomPart.toUpperCase()}`;
}
