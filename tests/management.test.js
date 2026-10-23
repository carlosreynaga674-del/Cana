import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/app.mjs";
import { prepareSignup, cookieValue } from "./helpers/age-fixture.mjs";
import { identityFixture } from "./helpers/identity-fixture.mjs";

const staffPassword = "Local management fixture staff password 42";
const workerPassword = "Local management fixture worker password 96";
const memberPassword = "Local management fixture member password 84";
const live = {
  businessName: "Local management fixture", businessJurisdiction: "Local tests only",
  storeLicenseNumber: "TEST-NOT-A-LICENCE", deliveryZips: ["2196"],
  pickupAddress: "Local isolated test fixture", contactEmail: "test@example.test",
  liveOrdersEnabled: true, legalSalesAuthorizationConfirmed: true, catalogApproved: true,
};
async function setup(t, { uploads = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cana-management-test-"));
  const identity = await identityFixture();
  const dbPath = join(directory, "app.sqlite");
  const server = createServer({ dbPath, config: live, adminPassword: staffPassword, staffPassword: workerPassword,
    ...(uploads ? { identityConfig: identity.config } : {}),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { body, cookie, headers, ...init } = {}) => fetch(base + path, {
    ...init, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const staff = await request("/api/admin/login", { method: "POST", body: { password: staffPassword } });
  assert.equal(staff.status, 200);
  return { request, identity, staffCookie: cookieValue(staff, "lc_staff"), dbPath };
}
async function signup(request, email = "managed-member@example.test", name = "Local Adult Fixture") {
  const prepared = await prepareSignup(request, { name, email, password: memberPassword,
    ageConfirmed: true, termsAccepted: true, identityConsent: true });
  const response = await request("/api/members/signup", { method: "POST", ...prepared });
  assert.equal(response.status, 201, await response.clone().text());
  return { member: (await response.json()).member, cookie: cookieValue(response, "lc_member") };
}
const productDetails = {
  name: "Local staff-managed grinder", category: "Accessories", type: "Accessory",
  description: "An isolated test product, never a real listed item.", price: 12345,
  size: "Standard", featured: false,
};
const orderDetails = (productId) => ({ fulfillment: "pickup", ageConfirmed: true,
  customer: { name: "Local Adult Fixture", email: "managed-member@example.test", phone: "0712345678" },
  items: [{ productId, sizeIndex: 0, quantity: 2, price: 1 }],
});

test("member, staff and admin sessions keep server-owned roles and admin overview permissions", async (t) => {
  const { request, staffCookie } = await setup(t, { uploads: false });
  const prepared = await prepareSignup(request, {
    name: "Local Role Member", email: "role-member@example.test", password: memberPassword,
    ageConfirmed: true, termsAccepted: true, identityConsent: true, role: "admin",
  });
  const registered = await request("/api/members/signup", { method: "POST", ...prepared });
  assert.equal(registered.status, 201, await registered.clone().text());
  const memberCookie = cookieValue(registered, "lc_member");
  assert.equal(cookieValue(registered, "lc_staff"), "");
  const member = (await registered.json()).member;
  assert.notEqual(member.role, "admin");
  assert.equal((await request("/api/admin/overview")).status, 401);
  assert.equal((await request("/api/admin/overview", { cookie: memberCookie })).status, 401);
  for (const role of ["admin", "staff"])
    assert.equal((await request("/api/admin/login", { method: "POST", body: { role, password: memberPassword } })).status, 401);
  assert.equal((await request("/api/admin/login", { method: "POST", body: { role: "owner", password: staffPassword } })).status, 422);
  const worker = await request("/api/admin/login", { method: "POST", body: { role: "staff", password: workerPassword } });
  assert.equal(worker.status, 200, await worker.clone().text());
  assert.equal((await worker.json()).role, "staff");
  const workerCookie = cookieValue(worker, "lc_staff");
  assert.equal((await (await request("/api/admin/session", { cookie: workerCookie })).json()).role, "staff");
  assert.equal((await request("/api/admin/overview", { cookie: workerCookie })).status, 403);
  assert.equal((await request("/api/admin/members", { cookie: workerCookie })).status, 200);
  assert.equal((await request("/api/admin/products", { cookie: workerCookie })).status, 200);
  assert.equal((await request("/api/admin/orders", { cookie: workerCookie })).status, 200);
  const administrator = await request("/api/admin/session", { cookie: staffCookie });
  assert.equal((await administrator.json()).role, "admin");
  const overview = await request("/api/admin/overview", { cookie: staffCookie });
  assert.equal(overview.status, 200);
  const summary = await overview.json();
  assert.equal(summary.members.total, 1);
  assert.equal(summary.products.published, 28);
  assert.equal(summary.orders.total, 0);
  assert.equal(summary.setup.staffConfigured, true);
  assert.equal((await request("/api/admin/logout", { method: "POST", cookie: workerCookie, body: {} })).status, 200);
  assert.equal((await request("/api/admin/session", { cookie: workerCookie })).status, 401);
  assert.equal((await request("/api/admin/overview", { cookie: staffCookie })).status, 200);
});

test("staff access fails closed when configured with the administrator's password", async (t) => {
  const server = createServer({ adminPassword: staffPassword, staffPassword });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + "/api/admin/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "staff", password: staffPassword }),
  });
  assert.equal(response.status, 503);
});

test("member directory is staff-only, paginated, searchable and excludes private identity fields", async (t) => {
  const { request, staffCookie } = await setup(t, { uploads: false });
  const one = await signup(request, "one@example.test", "Alex Directory");
  await signup(request, "two@example.test", "Jordan Directory");
  for (const path of ["/api/admin/members", "/api/admin/products"]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { cookie: one.cookie })).status, 401);
  }
  const response = await request("/api/admin/members?page=1&limit=1", { cookie: staffCookie });
  assert.equal(response.status, 200);
  const directory = await response.json();
  assert.equal(directory.total, 2);
  assert.equal(directory.members.length, 1);
  for (const member of directory.members) {
    assert.equal(member.birthDate, undefined);
    assert.equal(member.passwordHash, undefined);
    assert.equal(member.password_hash, undefined);
    assert.equal(member.favorites, undefined);
    assert.ok(member.ageVerification);
  }
  const found = await (await request("/api/admin/members?q=alex", { cookie: staffCookie })).json();
  assert.equal(found.total, 1);
  assert.equal(found.members[0].name, "Alex Directory");
  for (const query of ["page=0", "limit=1000", "page=abc"])
    assert.equal((await request(`/api/admin/members?${query}`, { cookie: staffCookie })).status, 422);
});

test("new signup requires ID and selfie uploads and cannot bypass the unavailable encrypted-storage gate", async (t) => {
  const { request, staffCookie } = await setup(t, { uploads: false });
  const { member, cookie } = await signup(request);
  assert.equal(member.identityVerification.required, true);
  assert.equal(member.identityVerification.configured, false);
  assert.notEqual(member.identityVerification.status, "verified");
  const start = await request("/api/members/identity-verification", { method: "POST", cookie, body: (await identityFixture()).body });
  assert.equal(start.status, 503);
  const manual = await request(`/api/admin/members/${member.id}/age-verification`, {
    method: "POST", cookie: staffCookie, body: { decision: "verified", method: "in_person",
      identityChecked: true, ageChecked: true, expectedSubmittedAt: member.ageVerification.submittedAt },
  });
  assert.equal(manual.status, 409);
  assert.equal((await request("/api/orders", { method: "POST", cookie, body: orderDetails("sunset-sherbet") })).status, 403);
  const current = (await (await request("/api/members/me", { cookie })).json()).member;
  assert.equal(current.ageVerification.status, "pending");
});

async function submitAndReview(request, identity, member, cookie, staffCookie) {
  const response = await request("/api/members/identity-verification", { method: "POST", cookie, body: identity.body });
  assert.equal(response.status, 200, await response.clone().text());
  const submitted = await response.json();
  assert.equal(submitted.verification.status, "pending");
  const queue = await (await request("/api/admin/members/age-verifications?status=pending", { cookie: staffCookie })).json();
  const pending = queue.members.find((item) => item.id === member.id);
  const decision = { method: "uploaded_id_selfie", decision: "verified", identityChecked: true,
    ageChecked: true, expectedSubmittedAt: pending.ageVerification.submittedAt,
    expectedUploadId: pending.identityVerification.uploadId };
  const checked = await request(`/api/admin/members/${member.id}/age-verification`, { method: "POST", cookie: staffCookie, body: decision });
  assert.equal(checked.status, 200, await checked.clone().text());
  return (await checked.json()).member;
}

test("ID and selfie uploads are private and require explicit staff review before verification", async (t) => {
  const { request, identity, staffCookie } = await setup(t);
  const { member, cookie } = await signup(request);
  assert.equal((await request("/api/members/identity-verification", { method: "POST", cookie, body: { ...identity.body, identityConsent: false } })).status, 422);
  assert.equal((await request("/api/members/identity-verification", { method: "POST", cookie, body: { ...identity.body, selfie: { data: Buffer.from("not an image").toString("base64") } } })).status, 422);
  const uploaded = await request("/api/members/identity-verification", { method: "POST", cookie, body: identity.body });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  assert.equal((await (await request("/api/members/me", { cookie })).json()).member.ageVerification.status, "pending");
  for (const kind of ["document", "selfie"]) {
    const path = `/api/admin/members/${member.id}/identity-documents/${kind}`;
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { cookie })).status, 401);
    const image = await request(path, { cookie: staffCookie });
    assert.equal(image.status, 200, await image.clone().text());
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.match(image.headers.get("cache-control"), /no-store/);
    assert.ok((await image.arrayBuffer()).byteLength > 100);
  }
  const queue = await (await request("/api/admin/members/age-verifications?status=pending", { cookie: staffCookie })).json();
  const pending = queue.members.find((item) => item.id === member.id);
  const review = { decision: "verified", method: "uploaded_id_selfie", expectedSubmittedAt: pending.ageVerification.submittedAt,
    expectedUploadId: pending.identityVerification.uploadId, identityChecked: true, ageChecked: true };
  assert.equal((await request(`/api/admin/members/${member.id}/age-verification`, { method: "POST", cookie: staffCookie, body: { ...review, method: "in_person" } })).status, 409);
  for (const change of [{ identityChecked: false }, { ageChecked: false }])
    assert.equal((await request(`/api/admin/members/${member.id}/age-verification`, { method: "POST", cookie: staffCookie, body: { ...review, ...change } })).status, 422);
  assert.equal((await request(`/api/admin/members/${member.id}/age-verification`, { method: "POST", cookie, body: review })).status, 401);
  assert.equal((await request(`/api/admin/members/${member.id}/age-verification`, { method: "POST", cookie: staffCookie, body: { ...review, expectedUploadId: "stale-upload-id" } })).status, 409);
  const checked = await request(`/api/admin/members/${member.id}/age-verification`, { method: "POST", cookie: staffCookie, body: review });
  assert.equal(checked.status, 200, await checked.clone().text());
  const current = (await checked.json()).member;
  assert.equal(current.ageVerification.status, "verified");
  assert.equal(current.ageVerification.method, "uploaded_id_selfie");
  assert.equal(current.identityVerification.status, "verified");
  assert.equal(current.birthDate, undefined);
  assert.equal((await request(`/api/admin/members/${member.id}/identity-documents/document`, { cookie: staffCookie })).status, 404);
});

test("staff publication updates public catalog and authoritative checkout; drafts, archives and stale edits stay protected", async (t) => {
  const { request, identity, staffCookie } = await setup(t);
  const { member, cookie } = await signup(request);
  await submitAndReview(request, identity, member, cookie, staffCookie);
  assert.equal((await request("/api/admin/products", { method: "POST", cookie, body: productDetails })).status, 401);
  const created = await request("/api/admin/products", { method: "POST", cookie: staffCookie, body: productDetails });
  assert.equal(created.status, 201, await created.clone().text());
  let product = (await created.json()).product;
  assert.equal(product.status, "draft");
  const publicProducts = async () => (await (await request("/api/products")).json()).products;
  assert.ok(!(await publicProducts()).some((p) => p.id === product.id));
  assert.equal((await request("/api/orders", { method: "POST", cookie, body: orderDetails(product.id) })).status, 422);
  const publish = await request(`/api/admin/products/${product.id}`, { method: "PATCH", cookie: staffCookie, body: { revision: product.revision, status: "published" } });
  assert.equal(publish.status, 200, await publish.clone().text());
  product = (await publish.json()).product;
  assert.equal((await publicProducts()).find((p) => p.id === product.id).price, 12345);
  const firstOrder = await request("/api/orders", { method: "POST", cookie, body: orderDetails(product.id) });
  assert.equal(firstOrder.status, 201, await firstOrder.clone().text());
  assert.equal((await firstOrder.json()).order.totals.subtotal, 24690);
  const price = await request(`/api/admin/products/${product.id}`, { method: "PATCH", cookie: staffCookie, body: { revision: product.revision, price: 15000 } });
  assert.equal(price.status, 200, await price.clone().text());
  assert.equal((await request(`/api/admin/products/${product.id}`, { method: "PATCH", cookie: staffCookie, body: { revision: product.revision, price: 5 } })).status, 409);
  product = (await price.json()).product;
  const secondOrder = await request("/api/orders", { method: "POST", cookie, body: orderDetails(product.id) });
  assert.equal(secondOrder.status, 201);
  assert.equal((await secondOrder.json()).order.totals.subtotal, 30000);
  const archived = await request(`/api/admin/products/${product.id}`, { method: "DELETE", cookie: staffCookie, body: { revision: product.revision } });
  assert.equal(archived.status, 200, await archived.clone().text());
  assert.ok(!(await publicProducts()).some((p) => p.id === product.id));
  assert.equal((await request("/api/orders", { method: "POST", cookie, body: orderDetails(product.id) })).status, 422);
});
