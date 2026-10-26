import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { databasePathFromEnv } from "../server/runtime-config.mjs";

test("production refuses missing, relative and memory databases before startup", () => {
  for (const value of [undefined, "", "   ", "orders.sqlite", ".local/orders.sqlite", ":memory:"]) {
    const env = { ...process.env, NODE_ENV: "production", DATABASE_PATH: value ?? "" };
    const child = spawnSync(process.execPath, ["server/index.mjs"], {
      cwd: path.resolve(import.meta.dirname, ".."), env, encoding: "utf8", timeout: 5000,
    });
    assert.equal(child.status, 1, value);
    assert.match(child.stderr, /Production requires DATABASE_PATH/);
    assert.doesNotMatch(child.stdout, /listening/);
  }
});

test("an explicit absolute production path is preserved and development retains its local default", () => {
  const root = path.resolve("/tmp/cana-runtime-fixture");
  assert.equal(databasePathFromEnv({ NODE_ENV: "production", DATABASE_PATH: "/var/data/orders.sqlite" }, root), "/var/data/orders.sqlite");
  assert.equal(databasePathFromEnv({ NODE_ENV: "development" }, root), path.join(root, ".local", "orders.sqlite"));
  assert.equal(databasePathFromEnv({ DATABASE_PATH: "local-fixture.sqlite" }, root), "local-fixture.sqlite");
  assert.throws(() => databasePathFromEnv({ DATABASE_PATH: "/var/data/bad\0path" }, root), /valid filesystem path/);
});
