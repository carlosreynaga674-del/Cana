import { businessContactEmail } from "./business.js";

export const offlinePreview =
  window.__LC_OFFLINE_PREVIEW__ === true ||
  window.location.protocol === "file:";
export const defaultStore = {
  mode: "demo",
  businessName: "Loud + Cana",
  jurisdiction: "Gauteng, South Africa",
  deliveryZips: [],
  pickupAddress: "",
  contactEmail: businessContactEmail,
  currency: "ZAR",
  readiness: { ready: false },
  available: false,
};

export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues)
    return Array.from(
      globalThis.crypto.getRandomValues(new Uint8Array(24)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  throw new Error(
    "A secure HTTPS connection is required to submit an order request.",
  );
}

export async function request(
  path,
  { method = "GET", body, token, idempotencyKey, signal, memberId } = {},
) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    signal,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...(memberId ? { "X-Member-ID": memberId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "The service is unavailable. Please try again shortly.",
    );
  }
  if (!response.ok) {
    const error = new Error(
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message ||
          payload.message ||
          "Your request could not be completed. Please try again.",
    );
    error.status = response.status;
    error.errors = payload.errors || payload.error?.errors;
    throw error;
  }
  return payload;
}

export function normalizeServerOrder(order, trackingToken) {
  return {
    ...order,
    mode: order.fulfillment,
    currency: "ZAR",
    serverBacked: true,
    trackingToken: trackingToken || order.trackingToken,
  };
}

export function trackingLink(order) {
  return `${window.location.origin}/?order=${encodeURIComponent(order.id)}#track=${encodeURIComponent(order.trackingToken)}`;
}
