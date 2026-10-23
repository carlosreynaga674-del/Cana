import test from "node:test";
import assert from "node:assert/strict";
import { publishedCatalog, safeProductImage } from "../src/lib/catalog.js";
import { products } from "../src/lib/products.js";

test("storefront accepts new published products without depending on bundled seed IDs", () => {
  const custom = { ...products[0], id: "staff-created-selection", name: "Fresh selection", price: 42900 };
  const catalog = publishedCatalog({ products: [custom] });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, custom.id);
  assert.equal(catalog[0].price, 42900);
  assert.deepEqual(publishedCatalog({ products: [] }), []);
});

test("malformed public catalog fails instead of silently showing seed or incomplete products", () => {
  const product = products[0];
  for (const payload of [
    {}, { products: null }, { products: [product, product] },
    { products: [{ ...product, price: -1 }] },
    { products: [{ ...product, category: "Unknown" }] },
    { products: [{ ...product, sizes: [{ label: "one", price: "100" }] }] },
    { products: [{ ...product, type: undefined }] },
  ]) assert.throws(() => publishedCatalog(payload), /could not be loaded/);
});

test("product images allow HTTPS or local raster assets and reject unsafe schemes or credentials", () => {
  assert.equal(safeProductImage("https://cdn.example.test/product.webp"), "https://cdn.example.test/product.webp");
  assert.equal(safeProductImage("/images/product-drink.webp"), "/images/product-drink.webp");
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "http://cdn.example.test/product.jpg", "https://user:password@example.test/image.jpg", "//example.test/image.png", "/images/../secrets.png", "/images/unsafe.svg"])
    assert.equal(safeProductImage(url), "");
});
