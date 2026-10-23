import React, { useState } from "react";
import { safeProductImage } from "../lib/catalog.js";

export default function ProductArt({ product, className = "" }) {
  const [failedImage, setFailedImage] = useState("");
  const customImage = safeProductImage(product.imageUrl);
  const useCustomImage = customImage && customImage !== failedImage;
  const fallback = product.visual === "drink"
    ? "/images/product-drink.webp"
    : `/images/reference-${product.visual}.webp`;
  return (
    <div
      className={`product-art photo-${product.visual} ${product.id === "night-cap" ? "night-art" : ""} ${product.id === "blue-dream" ? "blue-art" : ""} ${className}`}
      style={{ "--art-bg": product.color }}
    >
      <img
        src={useCustomImage ? customImage : fallback}
        alt={useCustomImage ? product.name : `${product.name} — illustrative ${product.category.toLowerCase()} presentation`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => useCustomImage && setFailedImage(customImage)}
      />
      {!useCustomImage && (
        <div
          className={`photo-package-label label-${product.visual}`}
          aria-hidden="true"
        >
          <span>
            LOUD <b>+</b> CANA
          </span>
          <strong>{product.name}</strong>
          <small>
            {product.visual === "flower"
              ? "PREMIUM FLOWER"
              : product.category.toUpperCase()}{" "}
            · {product.size.toUpperCase()}
          </small>
        </div>
      )}
    </div>
  );
}
