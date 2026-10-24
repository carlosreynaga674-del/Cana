import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkforce, WorkforceError } from "../server/workforce.mjs";

const PASSWORD = "Local staff test password 42";
const NEW_PASSWORD = "Changed local staff test password 84";
const details = (extra = {}) => ({ name: "Local Staff Reviewer", username: "reviewer.one", password: PASSWORD, ...extra });

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  return { db, workforce: createWorkforce({ db }) };
}
const errorStatus = (status, field) => (error) => error instanceof WorkforceError && error.status === status &&
  (!field || Object.hasOwn(error.errors || {}, field));

test("individual staff accounts store salted hashes, return safe profiles and authenticate without exposing secrets", async (t) => {
  const { db, workforce } = fixture(t);
  const account = await workforce.create(details(), "local-administrator-session-only");
  const second = await workforce.create(details({ username: "reviewer.two" }), "local-administrator-session-only");
  assert.equal(account.role, "staff");
  assert.equal(account.active, true);
  assert.equal(account.revision, 1);
  assert.equal(workforce.countActive(), 2);
  const rows = db.prepare("SELECT * FROM staff_users ORDER BY username").all();
  assert.notEqual(rows[0].password_salt, rows[1].password_salt);
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  assert.notEqual(rows[0].password_hash, PASSWORD);
  assert.equal(Buffer.from(rows[0].password_hash, "hex").length, 64);
  for (const field of ["password", "passwordHash", "password_hash", "password_salt", "credential_version"])
    assert.equal(Object.hasOwn(account, field), false);
  const login = await workforce.authenticate(" REVIEWER.ONE ", PASSWORD);
  assert.equal(login.staff.id, account.id);
  assert.equal(login.credentialVersion, 1);
  assert.deepEqual(workforce.validateSession(account.id, login.credentialVersion), account);
  assert.equal(await workforce.authenticate("reviewer.one", "a wrong password"), null);
  assert.equal(await workforce.authenticate("missing.account", PASSWORD), null);
  assert.equal(await workforce.authenticate("admin", PASSWORD), null);
  assert.equal(await workforce.authenticate("staff", PASSWORD), null);
  assert.equal(await workforce.authenticate("reviewer.one@example.test", PASSWORD), null);
  assert.equal(await workforce.authenticate("reviewer.one", "x".repeat(257)), null);
  const audit = db.prepare("SELECT * FROM workforce_audit ORDER BY id").all();
  assert.equal(audit[0].staff_id, account.id);
  assert.equal(audit[1].staff_id, second.id);
  assert.match(audit[0].actor_ref, /^[a-f0-9]{64}$/);
  assert.notEqual(audit[0].actor_ref, "local-administrator-session-only");
});

test("staff creation rejects privileged fields, reserved or malformed usernames and invalid passwords", async (t) => {
  const { workforce } = fixture(t);
  for (const username of ["admin", "STAFF", "ab", "9reviewer", "reviewer@example.test", "reviewer name", "x".repeat(41)])
    await assert.rejects(workforce.create(details({ username }), "admin-test"), errorStatus(422, "username"));
  for (const extra of [{ role: "admin" }, { active: true }, { id: "injected-id" }, { credentialVersion: 20 }])
    await assert.rejects(workforce.create(details(extra), "admin-test"), errorStatus(422));
  for (const password of [undefined, "too-short", "x".repeat(257), 1234567890123456])
    await assert.rejects(workforce.create(details({ password }), "admin-test"), errorStatus(422, "password"));
  await assert.rejects(workforce.create(details({ name: "a" }), "admin-test"), errorStatus(422, "name"));
  await assert.rejects(workforce.create(details({ name: "Name\u0000with control" }), "admin-test"), errorStatus(422, "name"));
  const created = await workforce.create(details({ username: " REVIEWER.ONE " }), "admin-test");
  assert.equal(created.username, "reviewer.one");
  await assert.rejects(workforce.create(details(), "admin-test"), errorStatus(409, "username"));
  assert.equal(workforce.list().total, 1);
});

test("staff search and pagination are literal, bounded and exclude disabled accounts when requested", async (t) => {
  const { workforce } = fixture(t);
  const first = await workforce.create(details({ name: "Reviewer 100%", username: "reviewer.one" }), "admin-test");
  await workforce.create(details({ name: "Different Team Member", username: "reviewer.two" }), "admin-test");
  await workforce.update(first.id, { revision: first.revision, active: false }, "admin-test");
  assert.equal(workforce.list({ search: "%" }).total, 1);
  assert.equal(workforce.list({ search: "_" }).total, 0);
  assert.equal(workforce.list({ search: "REVIEWER.TWO" }).staff[0].name, "Different Team Member");
  assert.equal(workforce.list({ status: "active" }).total, 1);
  assert.equal(workforce.list({ status: "disabled" }).staff[0].id, first.id);
  assert.equal(workforce.list({ limit: 1, offset: 1 }).staff.length, 1);
  for (const options of [{ search: "x".repeat(121) }, { status: "admin" }, { limit: 0 }, { limit: 101 }, { offset: -1 }, { limit: "20" }])
    assert.throws(() => workforce.list(options), errorStatus(422));
});

test("disable, re-enable, username changes and password resets invalidate earlier sessions", async (t) => {
  const { workforce } = fixture(t);
  let account = await workforce.create(details(), "admin-test");
  const first = await workforce.authenticate(account.username, PASSWORD);
  account = await workforce.update(account.id, { revision: account.revision, active: false }, "admin-test");
  assert.equal(account.active, false);
  assert.equal(workforce.validateSession(account.id, first.credentialVersion), null);
  assert.equal(await workforce.authenticate(account.username, PASSWORD), null);
  account = await workforce.update(account.id, { revision: account.revision, active: true }, "admin-test");
  assert.equal(workforce.validateSession(account.id, first.credentialVersion), null);
  const second = await workforce.authenticate(account.username, PASSWORD);
  account = await workforce.update(account.id, { revision: account.revision, password: NEW_PASSWORD }, "admin-test");
  assert.equal(workforce.validateSession(account.id, second.credentialVersion), null);
  assert.equal(await workforce.authenticate(account.username, PASSWORD), null);
  const third = await workforce.authenticate(account.username, NEW_PASSWORD);
  account = await workforce.update(account.id, { revision: account.revision, username: "reviewer.renamed" }, "admin-test");
  assert.equal(workforce.validateSession(account.id, third.credentialVersion), null);
  assert.equal(await workforce.authenticate("reviewer.one", NEW_PASSWORD), null);
  const fourth = await workforce.authenticate("reviewer.renamed", NEW_PASSWORD);
  assert.equal(fourth.staff.id, account.id);
  assert.equal(workforce.validateSession(account.id, String(fourth.credentialVersion)), null);
});

test("staff edits cannot elevate roles, overwrite a newer revision or take another username", async (t) => {
  const { workforce } = fixture(t);
  const first = await workforce.create(details(), "admin-test");
  const second = await workforce.create(details({ username: "second.reviewer" }), "admin-test");
  await assert.rejects(workforce.update(first.id, { revision: first.revision, role: "admin" }, "admin-test"), errorStatus(422, "role"));
  await assert.rejects(workforce.update(first.id, { name: "Changed without revision" }, "admin-test"), errorStatus(422, "revision"));
  await assert.rejects(workforce.update(first.id, { revision: first.revision, active: "false" }, "admin-test"), errorStatus(422, "active"));
  await assert.rejects(workforce.update(first.id, { revision: first.revision, username: second.username }, "admin-test"), errorStatus(409));
  const updated = await workforce.update(first.id, { revision: first.revision, name: "Updated Reviewer" }, "admin-test");
  await assert.rejects(workforce.update(first.id, { revision: first.revision, active: false }, "admin-test"), errorStatus(409));
  assert.equal(workforce.list({ search: first.username }).staff[0].revision, updated.revision);
  assert.equal(workforce.list({ search: first.username }).staff[0].active, true);
  await assert.rejects(workforce.update("missing-id", { revision: 1, active: false }, "admin-test"), errorStatus(404));
});

test("staff accounts and password/session versions survive storage restarts", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-workforce-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "team.sqlite");
  let db = new DatabaseSync(filename);
  let workforce = createWorkforce({ db });
  let account = await workforce.create(details(), "admin-test");
  const oldLogin = await workforce.authenticate(account.username, PASSWORD);
  account = await workforce.update(account.id, { revision: account.revision, password: NEW_PASSWORD }, "admin-test");
  db.close();
  db = new DatabaseSync(filename);
  t.after(() => db.close());
  workforce = createWorkforce({ db });
  assert.equal(workforce.validateSession(account.id, oldLogin.credentialVersion), null);
  assert.equal(await workforce.authenticate(account.username, PASSWORD), null);
  assert.equal((await workforce.authenticate(account.username, NEW_PASSWORD)).staff.id, account.id);
  assert.equal(workforce.list().staff[0].revision, 2);
});

test("staff mutation and its audit record roll back together if audit persistence fails", async (t) => {
  const { db, workforce } = fixture(t);
  const account = await workforce.create(details(), "admin-test");
  const login = await workforce.authenticate(account.username, PASSWORD);
  db.exec("CREATE TRIGGER fail_workforce_audit BEFORE INSERT ON workforce_audit BEGIN SELECT RAISE(ABORT,'local audit fixture failure'); END");
  await assert.rejects(workforce.update(account.id, { revision: account.revision, password: NEW_PASSWORD, active: false }, "admin-test"), /local audit fixture failure/);
  assert.equal(workforce.validateSession(account.id, login.credentialVersion).active, true);
  assert.equal((await workforce.authenticate(account.username, PASSWORD)).staff.id, account.id);
  assert.equal(await workforce.authenticate(account.username, NEW_PASSWORD), null);
  await assert.rejects(workforce.create(details({ username: "failed.reviewer" }), "admin-test"), /local audit fixture failure/);
  assert.equal(workforce.list().total, 1);
});

test("administrator authorization is checked after asynchronous password work and before committing", async (t) => {
  const { workforce } = fixture(t);
  const denied = () => { throw new WorkforceError(401, "Local revoked administrator fixture"); };
  await assert.rejects(workforce.create(details(), "admin-test", { assertAuthorized: denied }), errorStatus(401));
  assert.equal(workforce.list().total, 0);
  const account = await workforce.create(details(), "admin-test");
  await assert.rejects(workforce.update(account.id, { revision: account.revision, password: NEW_PASSWORD }, "admin-test", { assertAuthorized: denied }), errorStatus(401));
  assert.equal(workforce.list().staff[0].revision, 1);
  assert.equal((await workforce.authenticate(account.username, PASSWORD)).staff.id, account.id);
});

test("a disabled or reset account cannot finish a login that began before the change", async (t) => {
  const { db, workforce } = fixture(t);
  const account = await workforce.create(details(), "admin-test");
  const login = workforce.authenticate(account.username, PASSWORD);
  db.prepare("UPDATE staff_users SET credential_version=credential_version+1,active=0 WHERE id=?").run(account.id);
  assert.equal(await login, null);
});

test("concurrent credential updates use revisions and password work has bounded concurrency", async (t) => {
  const { workforce } = fixture(t);
  const account = await workforce.create(details(), "admin-test");
  const changes = [
    workforce.update(account.id, { revision: account.revision, password: NEW_PASSWORD }, "admin-test"),
    workforce.update(account.id, { revision: account.revision, password: "Other local staff password 123" }, "admin-test"),
  ];
  await assert.rejects(workforce.authenticate(account.username, PASSWORD), errorStatus(503));
  const results = await Promise.allSettled(changes);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const conflict = results.find((result) => result.status === "rejected");
  assert.equal(conflict.reason.status, 409);
  assert.equal(workforce.list().staff[0].revision, 2);
  assert.equal(await workforce.authenticate(account.username, PASSWORD), null);
});
