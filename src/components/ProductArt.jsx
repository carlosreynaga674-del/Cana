import React from "react";

export default function ProductArt({ product, className = "" }) {
  return (
    <div
      className={`product-art photo-${product.visual} ${product.id === "night-cap" ? "night-art" : ""} ${product.id === "blue-dream" ? "blue-art" : ""} ${className}`}
      style={{ "--art-bg": product.color }}
    >
      <img
        src={
          product.visual === "vape"
            ? "/images/luxury-vape.webp"
            : `/images/product-${product.visual}.webp`
        }
        alt={`${product.name} ${product.category.toLowerCase()} packaging`}
        loading="lazy"
      />
      {
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
      }
    </div>
  );
}
