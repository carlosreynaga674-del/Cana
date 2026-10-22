import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/app.mjs";
import { products } from "../src/lib/products.js";

// These are fictitious, local-only fixtures. Tests do not create real orders.
const adminPassword = "local-test-password-for-api-only";
const storeConfig = {
  businessName: "Loud + Cana Test Store",
  businessJurisdiction: "Local test fixture, Gauteng, ZA",
  storeLicenseNumber: "TEST-NOT-A-REAL-LICENSE",
  deliveryZips: ["2000"],
  pickupAddress: "123 Test Fixture Lane",
  contactEmail: "test@example.com",
  liveOrdersEnabled: true,
  catalogApproved: true,
  legalSalesAuthorizationConfirmed: true,
  publicOrigin: "",
  production: false,
};

function checkout(overrides = {}) {
  return {
    items: [{ productId: "sunset-sherbet", sizeIndex: 0, quantity: 1 }],
    fulfillment: "delivery",
    customer: {
      name: "Jordan Test",
      email: "jordan@example.com",
      phone: "+27 82 123 4567",
      address: "123 Example Avenue",
      city: "Test City",
      postcode: "2000",
    },
    notes: "Test notes, not a real delivery.",
    promoCode: "",
    ageConfirmed: true,
    ...overrides,
  };
}

async function start(t, options = {}) {
  const server = createServer({
    dbPath: ":memory:",
    config: { ...storeConfig },
    adminPassword,
    ...options,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  t.after(stop);
  const request = async (path, { body, ...init } = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return response;
  };
  return { base, server, stop, request };
}

async function createOrder(request, body = checkout(), key) {
  const response = await request("/api/orders", {
    method: "POST",
    body,
    headers: { "Idempotency-Key": key || crypto.randomUUID() },
  });
  assert.equal(response.status, 201, await response.clone().text());
  const result = await response.json();
  assert.ok(result.order?.id);
  assert.ok(
    typeof result.trackingToken === "string" &&
      result.trackingToken.length >= 32,
  );
  return result;
}

async function login(request) {
  const response = await request("/api/admin/login", {
    method: "POST",
    body: { password: adminPassword },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  return cookie.split(";")[0];
}

test("unconfigured store cannot accept live orders or expose credentials", async (t) => {
  const { request } = await start(t, {
    config: { ...storeConfig, storeLicenseNumber: "", liveOrdersEnabled: true },
  });
  const response = await request("/api/config");
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.mode, "demo");
  assert.equal(config.adminPassword, undefined);
  assert.equal(config.storeLicenseNumber, undefined);
  const order = await request("/api/orders", {
    method: "POST",
    body: checkout(),
  });
  assert.equal(order.status, 503);
});

test("configured store exposes sanitized configuration and authoritative catalog", async (t) => {
  const { request } = await start(t);
  const config = await (await request("/api/config")).json();
  assert.equal(config.mode, "live");
  assert.equal(config.businessName, storeConfig.businessName);
  assert.deepEqual(config.deliveryZips, ["2000"]);
  assert.equal(config.currency, "ZAR");
  const response = await request("/api/products");
  assert.equal(response.status, 200);
  const { products } = await response.json();
  assert.equal(products.length, 8);
  assert.equal(
    products.find((p) => p.id === "sunset-sherbet").price,
    (await import("../src/lib/products.js")).products.find(
      (p) => p.id === "sunset-sherbet",
    ).price,
  );
});

test("live order mode requires catalog approval and legal sales authorization independently", async (t) => {
  for (const blockedConfig of [
    { catalogApproved: false },
    { legalSalesAuthorizationConfirmed: false },
    { liveOrdersEnabled: false },
  ]) {
    const { request } = await start(t, {
      config: { ...storeConfig, ...blockedConfig },
    });
    const config = await (await request("/api/config")).json();
    assert.equal(config.mode, "demo");
    const response = await request("/api/orders", {
      method: "POST",
      body: checkout(),
    });
    assert.equal(response.status, 503);
  }
});

test("server calculates prices, options, discounts and fees independently of client totals", async (t) => {
  const { request } = await start(t);
  const { order, trackingToken } = await createOrder(
    request,
    checkout({
      items: [
        { productId: "sunset-sherbet", sizeIndex: 1, quantity: 2, price: 1 },
      ],
      promoCode: "loud15",
      totals: { total: 1 },
    }),
  );
  assert.equal(order.status, "pending");
  const subtotal =
    products.find((p) => p.id === "sunset-sherbet").sizes[1].price * 2;
  const discount = Math.round(subtotal * 0.15);
  const fee = subtotal >= 75000 ? 0 : 4900;
  assert.equal(order.totals.subtotal, subtotal);
  assert.equal(order.totals.discount, discount);
  assert.equal(order.totals.deliveryFee, fee);
  assert.equal(order.totals.total, subtotal - discount + fee);
  assert.equal(order.items[0].size, "7 g");
  assert.equal(order.notes, "Test notes, not a real delivery.");
  const tracking = await request(`/api/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${trackingToken}` },
  });
  assert.equal(tracking.status, 200);
  assert.equal((await tracking.json()).order.id, order.id);
});

test("order validation rejects absent age, invalid products, options, quantities, ZIP and contacts", async (t) => {
  const { request } = await start(t);
  const invalid = [
    checkout({ ageConfirmed: false }),
    checkout({ ageConfirmed: "true" }),
    checkout({ items: [] }),
    checkout({ items: [{ productId: "unknown-product", quantity: 1 }] }),
    checkout({
      items: [{ productId: "sunset-sherbet", sizeIndex: 99, quantity: 1 }],
    }),
    checkout({
      items: [{ productId: "sunset-sherbet", sizeIndex: 0, quantity: 0 }],
    }),
    checkout({
      items: [{ productId: "sunset-sherbet", sizeIndex: 0, quantity: 21 }],
    }),
    checkout({
      items: [{ productId: "sunset-sherbet", sizeIndex: 0, quantity: 1.5 }],
    }),
    checkout({ customer: { ...checkout().customer, postcode: "10001" } }),
    checkout({ customer: { ...checkout().customer, postcode: "abc" } }),
    checkout({ customer: { ...checkout().customer, phone: "123" } }),
    checkout({ customer: { ...checkout().customer, email: "invalid" } }),
    checkout({ customer: null }),
    checkout({ fulfillment: "airdrop" }),
    checkout({ promoCode: "UNRECOGNIZED" }),
  ];
  for (const body of invalid) {
    const response = await request("/api/orders", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    assert.ok(
      [400, 422].includes(response.status),
      `Expected invalid input rejection, got ${response.status}: ${JSON.stringify(body)}`,
    );
  }
});

test("tracking requires its opaque token and cannot enumerate another order", async (t) => {
  const { request } = await start(t);
  const first = await createOrder(request);
  const second = await createOrder(request);
  for (const headers of [
    {},
    { Authorization: "Bearer wrong-token" },
    { Authorization: `Bearer ${second.trackingToken}` },
  ]) {
    const response = await request(`/api/orders/${first.order.id}`, {
      headers,
    });
    assert.ok([401, 404].includes(response.status));
    assert.ok(!(await response.text()).includes(first.order.customer.email));
  }
});

test("idempotent retries do not create duplicate orders and conflicting reuse is rejected", async (t) => {
  const { request } = await start(t);
  const key = crypto.randomUUID();
  const first = await createOrder(request, checkout(), key);
  const retry = await request("/api/orders", {
    method: "POST",
    body: checkout(),
    headers: { "Idempotency-Key": key },
  });
  assert.ok([200, 201].includes(retry.status));
  const retried = await retry.json();
  assert.equal(retried.order.id, first.order.id);
  assert.equal(retried.trackingToken, first.trackingToken);
  const conflict = await request("/api/orders", {
    method: "POST",
    body: checkout({ notes: "Different request" }),
    headers: { "Idempotency-Key": key },
  });
  assert.equal(conflict.status, 409);
  const cookie = await login(request);
  const { orders } = await (
    await request("/api/admin/orders", { headers: { Cookie: cookie } })
  ).json();
  assert.equal(orders.length, 1);
});

test("staff authentication protects orders, enforces status transitions and supports logout", async (t) => {
  const { request } = await start(t);
  assert.equal((await request("/api/admin/orders")).status, 401);
  assert.equal(
    (
      await request("/api/admin/login", {
        method: "POST",
        body: { password: "incorrect" },
      })
    ).status,
    401,
  );
  const { order, trackingToken } = await createOrder(request);
  const cookie = await login(request);
  const result = await request("/api/admin/orders", {
    headers: { Cookie: cookie },
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).orders[0].id, order.id);
  const patch = (status) =>
    request(`/api/admin/orders/${order.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie },
      body: { status },
    });
  assert.equal((await patch("delivered")).status, 409);
  assert.equal((await patch("ready_for_pickup")).status, 409);
  for (const status of [
    "confirmed",
    "preparing",
    "out_for_delivery",
    "delivered",
  ]) {
    const response = await patch(status);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).order.status, status);
  }
  const tracked = await (
    await request(`/api/orders/${order.id}`, {
      headers: { Authorization: `Bearer ${trackingToken}` },
    })
  ).json();
  assert.equal(tracked.order.status, "delivered");
  const logout = await request("/api/admin/logout", {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.ok([200, 204].includes(logout.status));
  assert.equal(
    (await request("/api/admin/orders", { headers: { Cookie: cookie } }))
      .status,
    401,
  );
});

test("pickup has no delivery fee and follows its own fulfillment status path", async (t) => {
  const { request } = await start(t);
  const { order } = await createOrder(
    request,
    checkout({
      fulfillment: "pickup",
      customer: {
        name: "Jordan Test",
        email: "jordan@example.com",
        phone: "0821234567",
      },
    }),
  );
  assert.equal(order.totals.deliveryFee, 0);
  assert.equal(
    order.totals.total,
    products.find((p) => p.id === "sunset-sherbet").price,
  );
  const cookie = await login(request);
  for (const status of [
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "completed",
  ]) {
    assert.equal(
      (
        await request(`/api/admin/orders/${order.id}`, {
          method: "PATCH",
          headers: { Cookie: cookie },
          body: { status },
        })
      ).status,
      200,
    );
  }
});

test("order and tracking data survive a server restart without storing raw tracking token", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cana-api-persistence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "orders.sqlite");
  const first = await start(t, { dbPath });
  const result = await createOrder(first.request);
  await first.stop();
  const sqliteBytes = await readFile(dbPath);
  assert.equal(sqliteBytes.includes(Buffer.from(result.trackingToken)), false);
  const second = await start(t, { dbPath });
  const response = await second.request(`/api/orders/${result.order.id}`, {
    headers: { Authorization: `Bearer ${result.trackingToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).order.id, result.order.id);
});

test("same-origin mutations are accepted while foreign-origin mutations are blocked", async (t) => {
  const { base, request } = await start(t);
  const foreign = await request("/api/admin/login", {
    method: "POST",
    headers: { Origin: "https://untrusted.example" },
    body: { password: adminPassword },
  });
  assert.equal(foreign.status, 403);
  const sameOrigin = await request("/api/admin/login", {
    method: "POST",
    headers: { Origin: base },
    body: { password: adminPassword },
  });
  assert.equal(sameOrigin.status, 200);
  const crossSite = await request("/api/orders", {
    method: "POST",
    headers: { "Sec-Fetch-Site": "cross-site" },
    body: checkout(),
  });
  assert.equal(crossSite.status, 403);
});

test("repeated failed staff logins are rate limited", async (t) => {
  const { request } = await start(t);
  let limited = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await request("/api/admin/login", {
      method: "POST",
      body: { password: "wrong-password" },
    });
    assert.ok([401, 429].includes(response.status));
    if (response.status === 429) {
      assert.ok(response.headers.get("retry-after"));
      limited = true;
      break;
    }
  }
  assert.equal(
    limited,
    true,
    "Failed authentication attempts must eventually be throttled.",
  );
});

test("production responses use secure staff cookies and security headers", async (t) => {
  const { request } = await start(t, {
    config: { ...storeConfig, production: true },
  });
  const response = await request("/api/admin/login", {
    method: "POST",
    body: { password: adminPassword },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /; Secure/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("content-security-policy"));
});

test("static SPA serving stays within dist and never falls back for unknown API routes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cana-api-static-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const staticDir = join(root, "dist");
  await mkdir(join(staticDir, "assets"), { recursive: true });
  await writeFile(
    join(staticDir, "index.html"),
    "<!doctype html><h1>Client app</h1>",
  );
  await writeFile(
    join(staticDir, "assets", "app.js"),
    'console.log("client");',
  );
  await writeFile(join(root, "secrets.txt"), "NEVER-EXPOSE-THIS");
  const { request } = await start(t, { staticDir });
  assert.equal((await request("/")).status, 200);
  assert.match(await (await request("/staff")).text(), /Client app/);
  const asset = await request("/assets/app.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);
  assert.equal((await request("/api/not-a-route")).status, 404);
  assert.ok(
    !(await (await request("/%2e%2e/secrets.txt")).text()).includes(
      "NEVER-EXPOSE-THIS",
    ),
  );
  assert.ok(
    !(await (await request("/server/app.mjs")).text()).includes("createServer"),
  );
});
