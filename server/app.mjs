import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { products } from "../src/lib/products.js";
import { calculateTotals, validateCheckout } from "../src/lib/order.js";
import { createMemberHandlers } from "./members.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productById = new Map(products.map((product) => [product.id, product]));
const SESSION_AGE_MS = 8 * 60 * 60 * 1000;
const STATUS_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "ready_for_pickup", "cancelled"],
  out_for_delivery: ["delivered"],
  ready_for_pickup: ["completed"],
  delivered: [],
  completed: [],
  cancelled: [],
};
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const clean = (value) => (typeof value === "string" ? value.trim() : "");
const bool = (value) => value === true || value === "true";

class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export function configFromEnv(env = process.env) {
  return {
    businessName: clean(env.BUSINESS_NAME),
    businessJurisdiction: clean(env.BUSINESS_JURISDICTION),
    storeLicenseNumber: clean(env.STORE_LICENSE_NUMBER),
    deliveryZips: clean(env.DELIVERY_ZIPS)
      .split(",")
      .map(clean)
      .filter(Boolean),
    pickupAddress: clean(env.PICKUP_ADDRESS),
    contactEmail: clean(env.CONTACT_EMAIL),
    liveOrdersEnabled: bool(env.LIVE_ORDERS_ENABLED),
    legalSalesAuthorizationConfirmed: bool(
      env.LEGAL_SALES_AUTHORIZATION_CONFIRMED,
    ),
    catalogApproved: bool(env.CATALOG_APPROVED),
    publicOrigin: clean(env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL).replace(
      /\/$/,
      "",
    ),
    production: env.NODE_ENV === "production",
  };
}

function normalizeConfig(config = {}, adminPassword = "") {
  const c = {
    businessName: clean(config.businessName) || "Loud + Cana",
    businessJurisdiction: clean(config.businessJurisdiction),
    storeLicenseNumber: clean(config.storeLicenseNumber),
    deliveryZips: Array.isArray(config.deliveryZips)
      ? [
          ...new Set(
            config.deliveryZips.map(clean).filter((zip) => /^\d{4}$/.test(zip)),
          ),
        ]
      : [],
    pickupAddress: clean(config.pickupAddress),
    contactEmail: clean(config.contactEmail),
    liveOrdersEnabled: bool(config.liveOrdersEnabled),
    legalSalesAuthorizationConfirmed: bool(
      config.legalSalesAuthorizationConfirmed ||
        config.salesAuthorizationConfirmed,
    ),
    catalogApproved: bool(config.catalogApproved),
    publicOrigin: clean(config.publicOrigin).replace(/\/$/, ""),
    production: bool(config.production),
  };
  const checks = {
    BUSINESS_NAME: clean(config.businessName).length >= 2,
    BUSINESS_JURISDICTION: c.businessJurisdiction.length >= 2,
    STORE_LICENSE_NUMBER: c.storeLicenseNumber.length >= 3,
    DELIVERY_ZIPS: c.deliveryZips.length > 0,
    PICKUP_ADDRESS: c.pickupAddress.length >= 5,
    CONTACT_EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contactEmail),
    ADMIN_PASSWORD:
      typeof adminPassword === "string" && adminPassword.length >= 16,
    LIVE_ORDERS_ENABLED: c.liveOrdersEnabled,
    LEGAL_SALES_AUTHORIZATION_CONFIRMED: c.legalSalesAuthorizationConfirmed,
    CATALOG_APPROVED: c.catalogApproved,
  };
  c.missingRequirements = Object.keys(checks).filter((key) => !checks[key]);
  c.readiness = {
    liveOrdersEnabled: checks.LIVE_ORDERS_ENABLED,
    businessDetailsConfigured:
      checks.BUSINESS_NAME &&
      checks.BUSINESS_JURISDICTION &&
      checks.PICKUP_ADDRESS &&
      checks.CONTACT_EMAIL,
    licenseConfigured: checks.STORE_LICENSE_NUMBER,
    legalSalesAuthorizationConfirmed:
      checks.LEGAL_SALES_AUTHORIZATION_CONFIRMED,
    catalogApproved: checks.CATALOG_APPROVED,
    deliveryAreaConfigured: checks.DELIVERY_ZIPS,
    adminConfigured: checks.ADMIN_PASSWORD,
    ready: c.missingRequirements.length === 0,
    missingSetup: c.missingRequirements,
  };
  return c;
}

function publicConfig(config) {
  return {
    mode: config.readiness.ready ? "live" : "demo",
    businessName: config.businessName,
    jurisdiction: config.businessJurisdiction || "Gauteng, South Africa",
    deliveryZips: config.deliveryZips,
    pickupAddress: config.pickupAddress,
    contactEmail: config.contactEmail,
    readiness: config.readiness,
    missingRequirements: config.missingRequirements,
    currency: "ZAR",
    country: "ZA",
    deliveryFee: 4900,
    freeDelivery: 75000,
    orderReviewRequired: true,
    paymentCollectionEnabled: false,
  };
}

function validateOrder(body, config) {
  if (!isRecord(body)) throw new HttpError(400, "Please submit a valid order.");
  const errors = {};
  if (body.ageConfirmed !== true)
    errors.ageConfirmed = "You must confirm you are at least 21 years old.";
  if (!["delivery", "pickup"].includes(body.fulfillment))
    errors.fulfillment = "Choose delivery or pickup.";
  const rawCustomer = isRecord(body.customer) ? body.customer : {};
  const customer = {};
  const limits = {
    name: 100,
    email: 254,
    phone: 30,
    address: 240,
    city: 100,
    postcode: 10,
  };
  for (const [key, limit] of Object.entries(limits)) {
    customer[key] = clean(rawCustomer[key]);
    if (rawCustomer[key] !== undefined && typeof rawCustomer[key] !== "string")
      errors[key] = `Please enter a valid ${key}.`;
    if (customer[key].length > limit) errors[key] = `${key} is too long.`;
  }
  Object.assign(errors, validateCheckout(customer, body.fulfillment));
  if (
    body.fulfillment === "delivery" &&
    customer.postcode &&
    !config.deliveryZips.includes(customer.postcode)
  )
    errors.postcode =
      "This postal code is outside the configured delivery area.";
  const notes = clean(body.notes);
  if (body.notes !== undefined && typeof body.notes !== "string")
    errors.notes = "Order notes must be text.";
  if (notes.length > 1000)
    errors.notes = "Please keep order notes under 1,000 characters.";
  const promoCode = clean(body.promoCode).toUpperCase();
  if (body.promoCode !== undefined && typeof body.promoCode !== "string")
    errors.promoCode = "Please enter a valid promo code.";
  if (promoCode && promoCode !== "LOUD15")
    errors.promoCode = "That promo code is not available.";
  const items = [];
  const seen = new Set();
  if (
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 20
  )
    errors.items = "Choose between 1 and 20 product lines.";
  else
    for (const item of body.items) {
      if (!isRecord(item) || typeof item.productId !== "string") {
        errors.items = "Your bag contains an invalid item.";
        continue;
      }
      const product = productById.get(item.productId);
      if (!product) {
        errors.items = "A product in your bag is no longer available.";
        continue;
      }
      const sizeIndex = item.sizeIndex ?? 0;
      if (
        !Number.isInteger(sizeIndex) ||
        sizeIndex < 0 ||
        (product.sizes ? !product.sizes[sizeIndex] : sizeIndex !== 0)
      ) {
        errors.items = "Please choose an available product size.";
        continue;
      }
      if (
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 20
      ) {
        errors.items = "Choose between 1 and 20 of each item.";
        continue;
      }
      const lineId = `${product.id}:${sizeIndex}`;
      if (seen.has(lineId)) {
        errors.items = "Combine duplicate products into one bag item.";
        continue;
      }
      seen.add(lineId);
      const size = product.sizes?.[sizeIndex]?.label || product.size;
      const price = product.sizes?.[sizeIndex]?.price ?? product.price;
      items.push({
        ...product,
        productId: product.id,
        sizeIndex,
        size,
        price,
        quantity: item.quantity,
        lineId,
      });
    }
  if (Object.keys(errors).length)
    throw new HttpError(422, "Please check your order details.", errors);
  return {
    items,
    customer,
    fulfillment: body.fulfillment,
    notes,
    promoCode,
    ageConfirmed: true,
  };
}

function toPublicOrder(order) {
  return {
    ...order,
    customer: {
      name: order.customer.name,
      city: order.customer.city,
      postcode: order.customer.postcode,
    },
  };
}

function parseOrder(row) {
  return row
    ? {
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        status: row.status,
        fulfillment: row.fulfillment,
        mode: row.fulfillment,
        customer: JSON.parse(row.customer_json),
        items: JSON.parse(row.items_json),
        totals: JSON.parse(row.totals_json),
        notes: row.notes,
        promoCode: row.promo_code,
        currency: "ZAR",
        requiresStaffReview: true,
        paymentCollected: false,
      }
    : null;
}

async function readJson(req) {
  if (
    !String(req.headers["content-type"] || "")
      .toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "Use application/json for this request.");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 48 * 1024)
      throw new HttpError(413, "The request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request contains invalid JSON.");
  }
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A same-origin HTTP service. No real orders are accepted until all launch gates are supplied. */
export function createServer({
  dbPath = ":memory:",
  config = {},
  adminPassword = "",
  staticDir = path.join(ROOT, "dist"),
} = {}) {
  const settings = normalizeConfig(config, adminPassword);
  if (dbPath !== ":memory:")
    mkdirSync(path.dirname(path.resolve(dbPath)), {
      recursive: true,
      mode: 0o700,
    });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      status TEXT NOT NULL, fulfillment TEXT NOT NULL, customer_json TEXT NOT NULL,
      items_json TEXT NOT NULL, totals_json TEXT NOT NULL, notes TEXT NOT NULL,
      promo_code TEXT NOT NULL, tracking_hash TEXT NOT NULL,
      idempotency_hash TEXT UNIQUE, request_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at DESC);
  `);
  if (dbPath !== ":memory:")
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(file)) chmodSync(file, 0o600);
    }
  const storedSecret = db
    .prepare("SELECT value FROM metadata WHERE key = ?")
    .get("tracking_secret");
  const trackingSecret = storedSecret?.value || randomBytes(32).toString("hex");
  if (!storedSecret)
    db.prepare("INSERT INTO metadata (key,value) VALUES (?,?)").run(
      "tracking_secret",
      trackingSecret,
    );
  const passwordSalt = randomBytes(16);
  const passwordHash = settings.readiness.adminConfigured
    ? scryptSync(adminPassword, passwordSalt, 64)
    : null;
  const sessions = new Map();
  const rates = new Map();
  let databaseClosed = false;
  const send = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(data === null ? "" : JSON.stringify(data));
  };
  const tokenFor = (id, idempotencyKey) =>
    createHmac("sha256", trackingSecret)
      .update(`${id}\n${idempotencyKey}`)
      .digest("base64url");
  const findById = db.prepare("SELECT * FROM orders WHERE id = ?");
  const findIdempotency = db.prepare(
    "SELECT * FROM orders WHERE idempotency_hash = ?",
  );
  const insert = db.prepare(
    `INSERT INTO orders (id,created_at,updated_at,status,fulfillment,customer_json,items_json,totals_json,notes,promo_code,tracking_hash,idempotency_hash,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  function rateLimit(req, scope, max, windowMs) {
    const now = Date.now();
    if (rates.size > 10000)
      for (const [key, value] of rates)
        if (value.until <= now) rates.delete(key);
    const key = `${scope}:${req.socket.remoteAddress || "unknown"}`;
    let record = rates.get(key);
    if (!record || record.until <= now) {
      record = { count: 0, until: now + windowMs };
      rates.set(key, record);
    }
    record.count += 1;
    if (record.count > max) {
      const error = new HttpError(
        429,
        "Too many requests. Please try again later.",
      );
      error.retryAfter = Math.max(1, Math.ceil((record.until - now) / 1000));
      throw error;
    }
  }
  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (req.headers["sec-fetch-site"] === "cross-site" && !origin)
      throw new HttpError(403, "Cross-site requests are not allowed.");
    if (!origin) return; // Native clients may omit Origin. Browser JSON requests are same-origin only.
    let expected = settings.publicOrigin;
    if (!expected) {
      const protocol = req.socket.encrypted ? "https" : "http";
      expected = `${protocol}://${req.headers.host}`;
    }
    if (origin !== expected)
      throw new HttpError(403, "Cross-site requests are not allowed.");
  }
  function authenticate(req) {
    const cookie = String(req.headers.cookie || "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("lc_staff="));
    const token = cookie?.slice("lc_staff=".length) || "";
    const hash = sha256(token);
    const session = sessions.get(hash);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(hash);
      throw new HttpError(401, "Please sign in to the staff dashboard.");
    }
    return hash;
  }
  function sessionCookie(value, age) {
    return `lc_staff=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${settings.production ? "; Secure" : ""}`;
  }
  function serveFile(req, res, pathname) {
    if (!["GET", "HEAD"].includes(req.method))
      throw new HttpError(405, "Method not allowed.");
    if (!existsSync(staticDir))
      throw new HttpError(
        503,
        "The storefront build is not available. Run npm run build.",
      );
    const root = realpathSync(staticDir);
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, "Invalid URL.");
    }
    if (
      decoded.includes("\0") ||
      decoded.split("/").some((segment) => segment.startsWith("."))
    )
      throw new HttpError(404, "Not found.");
    let target = path.resolve(root, `.${decoded}`);
    if (target !== root && !target.startsWith(root + path.sep))
      throw new HttpError(404, "Not found.");
    if (existsSync(target) && statSync(target).isDirectory())
      target = path.join(target, "index.html");
    if (!existsSync(target)) {
      if (path.extname(target)) throw new HttpError(404, "Not found.");
      target = path.join(root, "index.html");
    }
    if (!existsSync(target) || !statSync(target).isFile())
      throw new HttpError(404, "Not found.");
    const real = realpathSync(target);
    if (!real.startsWith(root + path.sep))
      throw new HttpError(404, "Not found.");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
      "Cache-Control": target.includes(`${path.sep}assets${path.sep}`)
        ? "public,max-age=31536000,immutable"
        : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : readFileSync(real));
  }

  const handleMembers = createMemberHandlers({
    db,
    production: settings.production,
    send,
    readJson,
    rateLimit,
    HttpError,
    productIds: products.map((product) => product.id),
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    );
    if (settings.production)
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    try {
      const url = new URL(req.url, "http://local.invalid");
      const pathname = url.pathname;
      if (pathname.startsWith("/api/"))
        res.setHeader("Cache-Control", "no-store");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) checkOrigin(req);
      if (await handleMembers(req, res, pathname)) return;
      if (pathname === "/api/health" && req.method === "GET")
        return send(res, 200, {
          ok: true,
          service: "loud-cana",
          mode: settings.readiness.ready ? "live" : "demo",
        });
      if (pathname === "/api/config" && req.method === "GET")
        return send(res, 200, publicConfig(settings));
      if (pathname === "/api/products" && req.method === "GET")
        return send(res, 200, { products });
      if (pathname === "/api/orders" && req.method === "POST") {
        rateLimit(req, "order", 60, 15 * 60 * 1000);
        if (!settings.readiness.ready)
          throw new HttpError(
            503,
            "Live order requests are not enabled. The business must complete the launch requirements before accepting orders.",
          );
        const body = await readJson(req);
        const canonical = validateOrder(body, settings);
        const rawKey = clean(req.headers["idempotency-key"]);
        if (
          rawKey &&
          (rawKey.length < 16 ||
            rawKey.length > 200 ||
            !/^[A-Za-z0-9_-]+$/.test(rawKey))
        )
          throw new HttpError(400, "Please provide a valid idempotency key.");
        const keyHash = rawKey ? sha256(rawKey) : null;
        const requestHash = sha256(JSON.stringify(canonical));
        if (keyHash) {
          const existing = findIdempotency.get(keyHash);
          if (existing) {
            if (existing.request_hash !== requestHash)
              throw new HttpError(
                409,
                "This submission key has already been used for different order details.",
              );
            return send(res, 200, {
              order: toPublicOrder(parseOrder(existing)),
              trackingToken: tokenFor(existing.id, rawKey),
            });
          }
        }
        const id = `LC-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
        const token = rawKey
          ? tokenFor(id, rawKey)
          : randomBytes(32).toString("base64url");
        const now = new Date().toISOString();
        const totals = calculateTotals(
          canonical.items,
          canonical.fulfillment,
          canonical.promoCode,
        );
        db.exec("BEGIN IMMEDIATE");
        try {
          insert.run(
            id,
            now,
            now,
            "pending",
            canonical.fulfillment,
            JSON.stringify(canonical.customer),
            JSON.stringify(canonical.items),
            JSON.stringify(totals),
            canonical.notes,
            canonical.promoCode,
            sha256(token),
            keyHash,
            requestHash,
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return send(res, 201, {
          order: toPublicOrder(parseOrder(findById.get(id))),
          trackingToken: token,
        });
      }
      const orderMatch = pathname.match(/^\/api\/orders\/(LC-[A-Z0-9]+)$/);
      if (orderMatch && req.method === "GET") {
        rateLimit(req, "tracking", 180, 15 * 60 * 1000);
        const row = findById.get(orderMatch[1]);
        const token = /^Bearer ([A-Za-z0-9_-]{30,200})$/.exec(
          req.headers.authorization || "",
        )?.[1];
        if (
          !row ||
          !token ||
          !constantTimeEqual(row.tracking_hash, sha256(token))
        )
          throw new HttpError(
            404,
            "That order could not be found with this tracking key.",
          );
        return send(res, 200, { order: toPublicOrder(parseOrder(row)) });
      }
      if (pathname === "/api/admin/login" && req.method === "POST") {
        rateLimit(req, "login", 10, 15 * 60 * 1000);
        if (!passwordHash)
          throw new HttpError(503, "Staff access has not been configured.");
        const body = await readJson(req);
        const candidate =
          isRecord(body) &&
          typeof body.password === "string" &&
          body.password.length <= 256
            ? body.password
            : "";
        const candidateHash = scryptSync(candidate, passwordSalt, 64);
        if (!timingSafeEqual(candidateHash, passwordHash))
          throw new HttpError(401, "The staff password was not accepted.");
        const token = randomBytes(32).toString("base64url");
        sessions.set(sha256(token), { expiresAt: Date.now() + SESSION_AGE_MS });
        res.setHeader(
          "Set-Cookie",
          sessionCookie(token, SESSION_AGE_MS / 1000),
        );
        return send(res, 200, { ok: true });
      }
      if (pathname === "/api/admin/logout" && req.method === "POST") {
        const sessionHash = authenticate(req);
        sessions.delete(sessionHash);
        res.setHeader("Set-Cookie", sessionCookie("", 0));
        return send(res, 200, { ok: true });
      }
      if (pathname === "/api/admin/session" && req.method === "GET") {
        authenticate(req);
        return send(res, 200, { authenticated: true });
      }
      if (pathname === "/api/admin/orders" && req.method === "GET") {
        authenticate(req);
        return send(res, 200, {
          orders: db
            .prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500")
            .all()
            .map(parseOrder),
        });
      }
      const adminMatch = pathname.match(
        /^\/api\/admin\/orders\/(LC-[A-Z0-9]+)$/,
      );
      if (adminMatch && req.method === "PATCH") {
        authenticate(req);
        const row = findById.get(adminMatch[1]);
        if (!row) throw new HttpError(404, "Order not found.");
        const body = await readJson(req);
        const status = isRecord(body) ? body.status : null;
        if (!STATUS_TRANSITIONS[row.status]?.includes(status))
          throw new HttpError(409, "That status change is not available.");
        if (
          (status === "ready_for_pickup" && row.fulfillment !== "pickup") ||
          (status === "out_for_delivery" && row.fulfillment !== "delivery")
        )
          throw new HttpError(
            409,
            "That status does not match this order’s fulfillment method.",
          );
        db.prepare(
          "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
        ).run(status, new Date().toISOString(), row.id);
        return send(res, 200, { order: parseOrder(findById.get(row.id)) });
      }
      if (pathname.startsWith("/api/"))
        throw new HttpError(404, "API endpoint not found.");
      return serveFile(req, res, pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (error.retryAfter)
        res.setHeader("Retry-After", String(error.retryAfter));
      if (!res.headersSent)
        send(res, status, {
          error:
            status === 500
              ? "The server could not complete this request. Please try again."
              : error.message,
          ...(error.errors ? { errors: error.errors } : {}),
        });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", () => {
    if (!databaseClosed) {
      db.close();
      databaseClosed = true;
    }
    sessions.clear();
    rates.clear();
  });
  return server;
}
