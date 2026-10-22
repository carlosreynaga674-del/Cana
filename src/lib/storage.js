import { products } from "./products.js";

export function cleanCart(value) {
  if (!Array.isArray(value)) return [];
  const result = new Map();
  for (const row of value.slice(0, 50)) {
    if (!row || typeof row !== "object") continue;
    const product = products.find((p) => p.id === row.id);
    if (!product || !Number.isInteger(row.quantity) || row.quantity < 1)
      continue;
    const variant = product.sizes?.find((size) => size.label === row.size);
    const size = variant?.label || product.size;
    const lineId = `${product.id}-${size}`;
    const prior = result.get(lineId);
    result.set(lineId, {
      ...product,
      size,
      lineId,
      price: variant?.price || product.price,
      quantity: Math.min(20, (prior?.quantity || 0) + row.quantity),
    });
  }
  return [...result.values()];
}

export function cleanFavorites(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id) => products.some((p) => p.id === id)))]
    : [];
}

export function cleanLocation(value) {
  return {
    postcode:
      typeof value?.postcode === "string" && /^\d{4}$/.test(value.postcode)
        ? value.postcode
        : "",
    address:
      typeof value?.address === "string" ? value.address.slice(0, 200) : "",
    mode: value?.mode === "pickup" ? "pickup" : "delivery",
  };
}

export function cleanOrders(value) {
  if (!Array.isArray(value)) return [];
  const validItem = (item) =>
    item &&
    typeof item === "object" &&
    products.some((product) => product.id === item.id) &&
    ["name", "size"].every((key) => typeof item[key] === "string") &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0 &&
    item.quantity <= 20 &&
    Number.isInteger(item.price) &&
    item.price >= 0;
  return value
    .filter(
      (order) =>
        order &&
        typeof order === "object" &&
        order.currency === "ZAR" &&
        typeof order.id === "string" &&
        /^LC-[A-Z0-9-]+$/.test(order.id) &&
        typeof order.createdAt === "string" &&
        !Number.isNaN(Date.parse(order.createdAt)) &&
        Array.isArray(order.items) &&
        order.items.length &&
        order.items.every(validItem) &&
        order.totals &&
        ["total", "subtotal", "deliveryFee"].every(
          (key) => Number.isFinite(order.totals[key]) && order.totals[key] >= 0,
        ) &&
        typeof order.customer?.name === "string" &&
        (order.notes === undefined || typeof order.notes === "string"),
    )
    .slice(0, 10);
}

export function readSavedState(key, fallback, sanitize = (value) => value) {
  try {
    return sanitize(JSON.parse(localStorage.getItem(key)) ?? fallback);
  } catch {
    return fallback;
  }
}

export function toOrderItems(cart) {
  return cart.map((item) => ({
    productId: item.id,
    sizeIndex: Math.max(
      0,
      item.sizes?.findIndex((size) => size.label === item.size) || 0,
    ),
    quantity: item.quantity,
  }));
}
