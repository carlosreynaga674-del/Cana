import { categories } from "./products.js";

const productId = /^[a-z0-9][a-z0-9-]{0,99}$/;
const visuals = new Set(["flower", "preroll", "gummies", "vape", "drink", "accessory"]);

export function isProductId(value) {
  return typeof value === "string" && productId.test(value);
}

export function safeProductImage(value) {
  if (typeof value !== "string" || value.length > 2048) return "";
  if (/^\/media\/products\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(value))
    return value;
  if (/^\/images\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g|avif)$/i.test(value))
    return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

/** Fail closed if an incomplete API response would break product or bag views. */
export function publishedCatalog(payload) {
  if (!Array.isArray(payload?.products) || payload.products.length > 1000)
    throw new Error("The collection could not be loaded. Please try again.");
  const seen = new Set();
  return payload.products.map((product) => {
    if (
      !product || typeof product !== "object" ||
      !isProductId(product.id) || seen.has(product.id) ||
      !categories.slice(1).includes(product.category) ||
      !visuals.has(product.visual) ||
      !["name", "type", "size", "description"].every(
        (field) => typeof product[field] === "string" && product[field].trim(),
      ) ||
      !Number.isSafeInteger(product.price) || product.price < 1 ||
      (product.sizes !== undefined && (
        !Array.isArray(product.sizes) || !product.sizes.length ||
        product.sizes.some((size) => !size || typeof size.label !== "string" ||
          !size.label.trim() || !Number.isSafeInteger(size.price) || size.price < 1) ||
        new Set(product.sizes.map((size) => size.label)).size !== product.sizes.length
      ))
    ) throw new Error("The collection could not be loaded. Please try again.");
    seen.add(product.id);
    return {
      ...product,
      effect: typeof product.effect === "string" ? product.effect : "",
      flavor: typeof product.flavor === "string" ? product.flavor : "",
      mood: typeof product.mood === "string" ? product.mood : "",
      badge: typeof product.badge === "string" ? product.badge : "",
      badgeType: ["orange", "pink", "green"].includes(product.badgeType) ? product.badgeType : "green",
      color: /^#[a-f0-9]{6}$/i.test(product.color) ? product.color : "#171a15",
      imageUrl: safeProductImage(product.imageUrl),
    };
  });
}
