import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "../server/app.mjs";
import { prepareSignup, cookieValue } from "./helpers/age-fixture.mjs";
import { identityFixture } from "./helpers/identity-fixture.mjs";

const PASSWORD = "Isolated upload security fixture password 42";

async function fixture(t, configured = true) {
  const directory = await mkdtemp(join(tmpdir(), "cana-upload-security-"));
  const dbPath = join(directory, "members.sqlite");
  const identity = await identityFixture();
  const server = createServer({ dbPath, identityConfig: configured ? identity.config : {} });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const pending = new Set();
  t.after(async () => {
    for (const request of pending) request.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { body, cookie, ...options } = {}) => fetch(base + path, {
    ...options,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const prepared = await prepareSignup(request, {
    name: "Local Upload Security Fixture", email: "upload-security@example.test", password: PASSWORD,
    ageConfirmed: true, termsAccepted: true, identityConsent: true,
  });
  const signup = await request("/api/members/signup", { method: "POST", ...prepared });
  assert.equal(signup.status, 201, await signup.clone().text());
  const cookie = cookieValue(signup, "lc_member");
  const uploadRows = () => {
    const reader = new DatabaseSync(dbPath, { readOnly: true });
    try { return reader.prepare("SELECT count(*) AS total FROM member_identity_uploads").get().total; }
    finally { reader.close(); }
  };

  async function heldUpload(body) {
    const bytes = Buffer.from(JSON.stringify(body));
    const arrived = once(server, "request");
    let raw;
    const response = new Promise((resolve, reject) => {
      raw = http.request(base + "/api/members/identity-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": bytes.length, Cookie: cookie },
      }, async (incoming) => {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        resolve({ status: incoming.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      });
      raw.on("error", reject);
      raw.setTimeout(6000, () => raw.destroy(new Error("Local held upload timed out")));
    });
    // A controlled abort is expected in the resource-bound test.
    response.catch(() => {});
    pending.add(raw);
    raw.on("close", () => pending.delete(raw));
    raw.write(bytes.subarray(0, 1));
    await arrived;
    return {
      response,
      finish() { raw.end(bytes.subarray(1)); },
      abort() { raw.destroy(); },
    };
  }
  return { request, cookie, identity, heldUpload, uploadRows };
}

test("identity HTTP bodies are globally bounded before buffering and aborted uploads release capacity", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, false);
  const one = await f.heldUpload(f.identity.body);
  const two = await f.heldUpload(f.identity.body);
  const blocked = await f.request("/api/members/identity-verification", {
    method: "POST", cookie: f.cookie, body: f.identity.body,
  });
  assert.equal(blocked.status, 503);
  assert.match((await blocked.json()).error, /busy/i);
  one.abort(); two.abort();
  await Promise.allSettled([one.response, two.response]);
  await new Promise(setImmediate);
  const admitted = await f.request("/api/members/identity-verification", {
    method: "POST", cookie: f.cookie, body: f.identity.body,
  });
  assert.equal(admitted.status, 503);
  assert.match((await admitted.json()).error, /storage is not configured/i);
  assert.equal(f.uploadRows(), 0);
});

test("revoking a member session while an identity body arrives prevents any image storage", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const upload = await f.heldUpload(f.identity.body);
  const logout = await f.request("/api/members/logout", { method: "POST", cookie: f.cookie });
  assert.equal(logout.status, 200);
  upload.finish();
  const result = await upload.response;
  assert.equal(result.status, 401);
  assert.equal(f.uploadRows(), 0);
  const login = await f.request("/api/members/login", {
    method: "POST", body: { email: "upload-security@example.test", password: PASSWORD },
  });
  assert.equal(login.status, 200);
  const member = (await login.json()).member;
  assert.equal(member.identityVerification.status, "not_started");
  assert.equal(member.ageVerification.status, "pending");
  const status = await f.request("/api/members/identity-verification", { cookie: cookieValue(login, "lc_member") });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).verification.status, "not_started");
});
