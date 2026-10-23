import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "../server/app.mjs";

const password = "A local test password 123";
const signup = (overrides = {}) => ({
  name: "Jordan Member",
  email: "jordan@example.com",
  password,
  ageConfirmed: true,
  termsAccepted: true,
  ...overrides,
});

async function start(t, options = {}) {
  const server = createServer({ config: {}, ...options });
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
  const request = (path, { body, cookie, headers, ...rest } = {}) =>
    fetch(`${base}${path}`, {
      ...rest,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { base, request, stop };
}

async function register(request, body = signup()) {
  const response = await request("/api/members/signup", {
    method: "POST",
    body,
  });
  assert.equal(response.status, 201, await response.clone().text());
  return {
    cookie: response.headers.get("set-cookie").split(";")[0],
    response,
    ...(await response.json()),
  };
}

test("membership creates real catalog-mode accounts and discloses only safe own-profile fields", async (t) => {
  const { request } = await start(t);
  assert.deepEqual(await (await request("/api/members/me")).json(), {
    member: null,
  });
  const { member, cookie, response } = await register(
    request,
    signup({ email: " JORDAN@EXAMPLE.COM " }),
  );
  assert.equal(member.email, "jordan@example.com");
  assert.equal(member.name, "Jordan Member");
  assert.deepEqual(member.favorites, []);
  assert.equal(
    Object.keys(member).sort().join(","),
    "createdAt,email,favorites,id,name",
  );
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.match(response.headers.get("set-cookie"), /Path=\/api\/members/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    await (await request("/api/members/me", { cookie })).json(),
    { member },
  );
  assert.equal(
    (await request("/api/config").then((r) => r.json())).mode,
    "demo",
  );
  assert.equal((await request("/api/admin/session", { cookie })).status, 401);
});

test("membership validates signup, age, consent, JSON and duplicate normalized email", async (t) => {
  const { request } = await start(t);
  const response = await request("/api/members/signup", {
    method: "POST",
    body: signup({
      name: "",
      email: "not-email",
      password: "short",
      ageConfirmed: "true",
      termsAccepted: false,
    }),
  });
  assert.equal(response.status, 422);
  const { errors } = await response.json();
  assert.deepEqual(Object.keys(errors).sort(), [
    "ageConfirmed",
    "email",
    "name",
    "password",
    "termsAccepted",
  ]);
  assert.equal(
    (
      await request("/api/members/signup", {
        method: "POST",
        body: signup({ confirmPassword: "different" }),
      })
    ).status,
    422,
  );
  assert.equal(
    (await request("/api/members/signup", { method: "POST", body: [] })).status,
    400,
  );
  assert.equal(
    (
      await request("/api/members/signup", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: signup(),
      })
    ).status,
    415,
  );
  await register(request);
  assert.equal(
    (
      await request("/api/members/signup", {
        method: "POST",
        body: signup({ email: "JORDAN@EXAMPLE.COM" }),
      })
    ).status,
    409,
  );
});

test("membership login gives generic failures, isolates users and supports actual logout", async (t) => {
  const { request } = await start(t);
  const first = await register(request);
  const second = await register(
    request,
    signup({ email: "other@example.com", name: "Other Member" }),
  );
  const wrong = await request("/api/members/login", {
    method: "POST",
    body: { email: first.member.email, password: "wrong" },
  });
  const missing = await request("/api/members/login", {
    method: "POST",
    body: { email: "missing@example.com", password: "wrong" },
  });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.deepEqual(await wrong.json(), await missing.json());
  const signedIn = await request("/api/members/login", {
    method: "POST",
    body: { email: "JORDAN@EXAMPLE.COM", password },
  });
  assert.equal(signedIn.status, 200);
  assert.equal((await signedIn.json()).member.id, first.member.id);
  const cookie = signedIn.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await request("/api/members/me", { cookie: second.cookie }).then((r) =>
        r.json(),
      )
    ).member.id,
    second.member.id,
  );
  const logout = await request("/api/members/logout", {
    method: "POST",
    cookie,
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.deepEqual(
    await request("/api/members/me", { cookie }).then((r) => r.json()),
    { member: null },
  );
  assert.equal(
    (
      await request("/api/members/me", {
        method: "PATCH",
        cookie,
        body: { name: "Anonymous" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/members/me", {
        cookie: "lc_member=forged-token",
      }).then((r) => r.json())
    ).member,
    null,
  );
});

test("member profiles and saved favourites are server-backed, validated and isolated", async (t) => {
  const { request } = await start(t);
  const first = await register(request);
  const second = await register(
    request,
    signup({ email: "other@example.com" }),
  );
  const update = await request("/api/members/me", {
    method: "PATCH",
    cookie: first.cookie,
    body: {
      name: "Jordan Updated",
      favorites: ["sunset-sherbet", "peach-state", "sunset-sherbet"],
    },
  });
  assert.equal(update.status, 200);
  const { member } = await update.json();
  assert.equal(member.name, "Jordan Updated");
  assert.deepEqual(member.favorites, ["sunset-sherbet", "peach-state"]);
  assert.deepEqual(
    (
      await request("/api/members/me", { cookie: second.cookie }).then((r) =>
        r.json(),
      )
    ).member.favorites,
    [],
  );
  assert.equal(
    (
      await request("/api/members/me", {
        method: "PATCH",
        cookie: first.cookie,
        body: { favorites: ["not-a-product"] },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/api/members/me", {
        method: "PATCH",
        cookie: first.cookie,
        body: { name: "x" },
      })
    ).status,
    422,
  );
  const freshLogin = await request("/api/members/login", {
    method: "POST",
    body: { email: first.member.email, password },
  });
  assert.deepEqual(
    (await freshLogin.json()).member.favorites,
    member.favorites,
  );
});

test("password changes rotate this session, revoke other sessions and reject the previous password", async (t) => {
  const { request } = await start(t);
  const registered = await register(request);
  const login = await request("/api/members/login", {
    method: "POST",
    body: { email: registered.member.email, password },
  });
  const otherCookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await request("/api/members/password", {
        method: "POST",
        cookie: registered.cookie,
        body: {
          currentPassword: "wrong",
          newPassword: "An updated test password",
        },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/members/password", {
        method: "POST",
        cookie: registered.cookie,
        body: { currentPassword: password, newPassword: "short" },
      })
    ).status,
    422,
  );
  const changed = await request("/api/members/password", {
    method: "POST",
    cookie: registered.cookie,
    body: {
      currentPassword: password,
      newPassword: "An updated test password",
    },
  });
  assert.equal(changed.status, 200);
  const currentCookie = changed.headers.get("set-cookie").split(";")[0];
  assert.notEqual(currentCookie, registered.cookie);
  for (const cookie of [registered.cookie, otherCookie])
    assert.equal(
      (await request("/api/members/me", { cookie }).then((r) => r.json()))
        .member,
      null,
    );
  assert.equal(
    (
      await request("/api/members/me", { cookie: currentCookie }).then((r) =>
        r.json(),
      )
    ).member.id,
    registered.member.id,
  );
  assert.equal(
    (
      await request("/api/members/login", {
        method: "POST",
        body: { email: registered.member.email, password },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/members/login", {
        method: "POST",
        body: {
          email: registered.member.email,
          password: "An updated test password",
        },
      })
    ).status,
    200,
  );
});

test("deleting a member requires the password and invalidates the account and all sessions", async (t) => {
  const { request } = await start(t);
  const registered = await register(request);
  assert.equal(
    (
      await request("/api/members/me", {
        method: "DELETE",
        cookie: registered.cookie,
        body: { password: "wrong" },
      })
    ).status,
    401,
  );
  const deleted = await request("/api/members/me", {
    method: "DELETE",
    cookie: registered.cookie,
    body: { password },
  });
  assert.equal(deleted.status, 200);
  assert.match(deleted.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (
      await request("/api/members/me", { cookie: registered.cookie }).then(
        (r) => r.json(),
      )
    ).member,
    null,
  );
  assert.equal(
    (
      await request("/api/members/login", {
        method: "POST",
        body: { email: registered.member.email, password },
      })
    ).status,
    401,
  );
});

test("member passwords and session tokens are hashed at rest, and accounts/sessions survive restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cana-members-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "members.sqlite");
  const firstServer = await start(t, { dbPath });
  const registered = await register(firstServer.request);
  await firstServer.stop();
  const database = new DatabaseSync(dbPath);
  const stored = database
    .prepare("SELECT * FROM members WHERE id = ?")
    .get(registered.member.id);
  assert.equal(stored.password_hash.length, 128);
  assert.notEqual(stored.password_hash, password);
  assert.equal(stored.password_salt.length, 32);
  assert.equal(stored.terms_version, "2026-10-22");
  assert.ok(stored.age_confirmed_at && stored.terms_accepted_at);
  const session = database
    .prepare("SELECT * FROM member_sessions WHERE member_id = ?")
    .get(registered.member.id);
  assert.equal(session.token_hash.length, 64);
  assert.ok(!JSON.stringify(stored).includes(password));
  assert.ok(!JSON.stringify(session).includes(registered.cookie.split("=")[1]));
  database.close();
  const restarted = await start(t, { dbPath });
  assert.equal(
    (
      await restarted
        .request("/api/members/me", { cookie: registered.cookie })
        .then((r) => r.json())
    ).member.id,
    registered.member.id,
  );
  const login = await restarted.request("/api/members/login", {
    method: "POST",
    body: { email: registered.member.email, password },
  });
  assert.equal(login.status, 200);
});

test("expired persisted sessions cannot authenticate", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "cana-members-expiry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "members.sqlite");
  const { request } = await start(t, { dbPath });
  const registered = await register(request);
  const database = new DatabaseSync(dbPath);
  database.prepare("UPDATE member_sessions SET expires_at = 0").run();
  database.close();
  const response = await request("/api/members/me", {
    cookie: registered.cookie,
  });
  assert.deepEqual(await response.json(), { member: null });
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("member mutations enforce same-origin policy, and production sessions use Secure cookies", async (t) => {
  const { request } = await start(t, {
    config: { production: true, publicOrigin: "https://store.example" },
  });
  const foreign = await request("/api/members/signup", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
    body: signup(),
  });
  assert.equal(foreign.status, 403);
  const response = await request("/api/members/signup", {
    method: "POST",
    headers: { Origin: "https://store.example" },
    body: signup(),
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /; Secure/);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal(
    (
      await request("/api/members/logout", {
        method: "POST",
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
});

test("repeated member login failures are rate limited for the target account", async (t) => {
  const { request } = await start(t);
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await request("/api/members/login", {
      method: "POST",
      body: { email: "unknown@example.com", password: "wrong" },
    });
    assert.equal(response.status, 401);
  }
  const limited = await request("/api/members/login", {
    method: "POST",
    body: { email: "unknown@example.com", password: "wrong" },
  });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});
