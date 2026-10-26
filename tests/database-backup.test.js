import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { backupDatabase, restoreDatabase, runDatabaseCommand, verifyDatabase } from "../scripts/database-backup.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "database-backup.mjs");
const PRIVATE_VALUE = "Private fixture data must never appear in CLI output";

async function fixture(t, { wal = false, invalidForeignKey = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-database-recovery-"));
  const source = path.join(directory, "source.sqlite");
  const db = new DatabaseSync(source);
  db.exec("PRAGMA foreign_keys=" + (invalidForeignKey ? "OFF" : "ON") + ";" +
    (wal ? "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;" : "") +
    "CREATE TABLE accounts(id TEXT PRIMARY KEY,value TEXT NOT NULL);" +
    "CREATE TABLE history(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),amount INTEGER NOT NULL);");
  db.prepare("INSERT INTO accounts VALUES(?,?)").run("local-member", PRIVATE_VALUE);
  db.prepare("INSERT INTO history VALUES(?,?,?)").run("local-ledger", invalidForeignKey ? "missing-member" : "local-member", 1000);
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, source, db, output: path.join(directory, "backups", "snapshot.sqlite") };
}

async function absent(filename) {
  await assert.rejects(lstat(filename), { code: "ENOENT" });
}

test("a live WAL backup preserves committed account and ledger data and restores to a verified new database", async (t) => {
  const f = await fixture(t, { wal: true });
  assert.ok((await lstat(f.source + "-wal")).size > 0);
  f.db.prepare("INSERT INTO history VALUES(?,?,?)").run("latest-wal-only-entry", "local-member", 750);
  const backedUp = await backupDatabase(f.source, f.output);
  assert.equal(backedUp.verified, true);
  assert.equal(backedUp.checksumVerified, true);
  assert.equal((await lstat(path.dirname(f.output))).mode & 0o777, 0o700);
  assert.equal((await lstat(f.output)).mode & 0o777, 0o600);
  assert.equal((await lstat(f.output + ".sha256")).mode & 0o777, 0o600);
  assert.equal(backedUp.sha256, createHash("sha256").update(await readFile(f.output)).digest("hex"));
  for (const suffix of ["-wal", "-shm", "-journal"]) await absent(f.output + suffix);
  const snapshot = new DatabaseSync(f.output, { readOnly: true });
  try {
    assert.equal(snapshot.prepare("SELECT sum(amount) AS amount FROM history").get().amount, 1750);
    assert.equal(snapshot.prepare("SELECT value FROM accounts").get().value, PRIVATE_VALUE);
  } finally { snapshot.close(); }
  f.db.prepare("UPDATE accounts SET value=?").run("Later source value");
  const destination = path.join(f.directory, "restored", "recovered.sqlite");
  const restored = await restoreDatabase(f.output, destination);
  assert.equal(restored.verified, true);
  assert.equal(restored.checksumVerified, true);
  assert.equal(f.db.prepare("SELECT value FROM accounts").get().value, "Later source value");
  const recovered = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(recovered.prepare("SELECT value FROM accounts").get().value, PRIVATE_VALUE);
    assert.equal(recovered.prepare("SELECT sum(amount) AS amount FROM history").get().amount, 1750);
    assert.equal(recovered.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(recovered.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { recovered.close(); }
});

test("checksum tampering blocks verification and restoration without creating recovery files", async (t) => {
  const f = await fixture(t);
  await backupDatabase(f.source, f.output);
  await writeFile(f.output, Buffer.concat([await readFile(f.output), Buffer.from("unexpected change")]));
  await assert.rejects(verifyDatabase(f.output), /checksum verification failed/);
  const destination = path.join(f.directory, "recovery", "tampered.sqlite");
  await assert.rejects(restoreDatabase(f.output, destination), /checksum verification failed/);
  await absent(destination);
  await absent(destination + ".sha256");
});

test("integrity and foreign-key failures clean up the attempted snapshot and checksum", async (t) => {
  const f = await fixture(t, { invalidForeignKey: true });
  await assert.rejects(backupDatabase(f.source, f.output), /foreign-key verification failed/);
  for (const suffix of ["", ".sha256", "-wal", "-shm", "-journal"]) await absent(f.output + suffix);
  assert.equal(f.db.prepare("SELECT account_id FROM history").get().account_id, "missing-member");
});

test("backup and restore never overwrite existing databases, checksum files or journal sidecars", async (t) => {
  const f = await fixture(t);
  await backupDatabase(f.source, f.output);
  const bytes = await readFile(f.output);
  const sum = await readFile(f.output + ".sha256");
  await assert.rejects(backupDatabase(f.source, f.output), /already exists/);
  await assert.rejects(restoreDatabase(f.output, f.source), /already exists/);
  assert.deepEqual(await readFile(f.output), bytes);
  assert.deepEqual(await readFile(f.output + ".sha256"), sum);
  const protectedOutput = path.join(f.directory, "checksum-only.sqlite");
  await writeFile(protectedOutput + ".sha256", "Existing unrelated checksum", { mode: 0o600 });
  await assert.rejects(backupDatabase(f.source, protectedOutput), /already exists/);
  await absent(protectedOutput);
  assert.equal(await readFile(protectedOutput + ".sha256", "utf8"), "Existing unrelated checksum");
  const journalOutput = path.join(f.directory, "journal-only.sqlite");
  await writeFile(journalOutput + "-wal", "Existing unrelated journal", { mode: 0o600 });
  await assert.rejects(backupDatabase(f.source, journalOutput), /already exists/);
  assert.equal(await readFile(journalOutput + "-wal", "utf8"), "Existing unrelated journal");
  await assert.rejects(backupDatabase(f.source, f.source), /must differ/);
});

test("recovery rejects symlink paths and leaves unrelated targets untouched", async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.directory, "alias.sqlite");
  await symlink(f.source, alias);
  await assert.rejects(backupDatabase(alias, f.output), /Symlink/);
  await absent(f.output);
  const realDirectory = path.join(f.directory, "real-private");
  await mkdir(realDirectory, { mode: 0o700 });
  const linkedDirectory = path.join(f.directory, "linked-private");
  await symlink(realDirectory, linkedDirectory);
  await assert.rejects(backupDatabase(f.source, path.join(linkedDirectory, "new.sqlite")), /Symlink/);
  assert.deepEqual(await readdir(realDirectory), []);
  await backupDatabase(f.source, f.output);
  await rm(f.output + ".sha256");
  await symlink(f.source, f.output + ".sha256");
  await assert.rejects(verifyDatabase(f.output), /Symlink/);
  assert.equal(f.db.prepare("SELECT value FROM accounts").get().value, PRIVATE_VALUE);
});

test("recovery outputs require private directories and cannot enter the repository or public release", async (t) => {
  const f = await fixture(t);
  const publicDirectory = path.join(f.directory, "public-mode");
  await mkdir(publicDirectory, { mode: 0o755 });
  await chmod(publicDirectory, 0o755);
  await assert.rejects(backupDatabase(f.source, path.join(publicDirectory, "new.sqlite")), /private/);
  assert.equal((await lstat(publicDirectory)).mode & 0o777, 0o755);
  for (const directory of ["public", "dist", "release", ".local", "scripts"])
    await assert.rejects(backupDatabase(f.source, path.join(ROOT, directory, "must-not-be-created.sqlite")), /outside the repository/);
  await assert.rejects(backupDatabase(f.source, "relative.sqlite"), /absolute/);
  await assert.rejects(backupDatabase(f.source, path.join(f.directory, "new.db")), /ending in .sqlite/);
});

test("verify and restore require standalone snapshots while backup can read an active WAL database", async (t) => {
  const f = await fixture(t, { wal: true });
  await assert.rejects(verifyDatabase(f.source), /standalone/);
  await assert.rejects(restoreDatabase(f.source, f.output), /standalone/);
  await absent(f.output);
  await backupDatabase(f.source, f.output);
  const verified = await verifyDatabase(f.output);
  assert.equal(verified.checksumVerified, true);
  await rm(f.output + ".sha256");
  const withoutChecksum = await verifyDatabase(f.output);
  assert.equal(withoutChecksum.verified, true);
  assert.equal(withoutChecksum.checksumVerified, false);
  await writeFile(f.output + ".sha256", withoutChecksum.sha256 + "  different.sqlite\n", { mode: 0o600 });
  await assert.rejects(verifyDatabase(f.output), /does not identify this database/);
});

test("missing, corrupt or malformed recovery inputs cannot create an empty replacement database", async (t) => {
  const f = await fixture(t);
  const missing = path.join(f.directory, "missing.sqlite");
  await assert.rejects(backupDatabase(missing, f.output), /already exist/);
  await absent(missing);
  const broken = path.join(f.directory, "broken.sqlite");
  await writeFile(broken, "This is not SQLite data.", { mode: 0o600 });
  await assert.rejects(backupDatabase(broken, f.output), /readable SQLite/);
  await assert.rejects(verifyDatabase(broken), /readable SQLite/);
  await absent(f.output);
  await assert.rejects(runDatabaseCommand(["backup", "--database", f.source]), /--output/);
  await assert.rejects(runDatabaseCommand(["verify", "--database", f.source, "--output", f.output]), /does not accept/);
  await assert.rejects(runDatabaseCommand(["backup", "--database", f.source, "--database", f.source]), /once/);
  await assert.rejects(runDatabaseCommand(["backup", "--unknown", "value"]), /supported option/);
});

test("CLI supports help and DATABASE_PATH while printing only recovery metadata", async (t) => {
  const f = await fixture(t);
  const help = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /backup/);
  assert.match(help.stdout, /never.*DATABASE_PATH/i);
  const result = spawnSync(process.execPath, [SCRIPT, "backup", "--output", f.output], {
    encoding: "utf8", env: { ...process.env, DATABASE_PATH: f.source },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.command, "backup");
  assert.equal(output.database, f.output);
  assert.equal(output.checksumVerified, true);
  assert.equal((result.stdout + result.stderr).includes(PRIVATE_VALUE), false);
  const checked = spawnSync(process.execPath, [SCRIPT, "verify", "--database", f.output], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).sha256, output.sha256);
  const fail = spawnSync(process.execPath, [SCRIPT, "backup", "--database", f.source, "--output", f.output], { encoding: "utf8" });
  assert.equal(fail.status, 1);
  assert.equal(fail.stdout, "");
  assert.equal(fail.stderr.includes(PRIVATE_VALUE), false);
});
