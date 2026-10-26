#!/usr/bin/env node
/** Private, operator-run SQLite snapshots. Never serve these files over HTTP. */
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIDECARS = ["-wal", "-shm", "-journal"];
const HELP = [
  "Private Loud + Cana database recovery tools (Node.js 24)",
  "",
  "  database-backup.mjs backup --database /absolute/source.sqlite --output /private/backups/new.sqlite",
  "  database-backup.mjs verify --database /private/backups/new.sqlite",
  "  database-backup.mjs restore --database /private/backups/new.sqlite --output /private/recovery/new.sqlite",
  "",
  "DATABASE_PATH supplies --database when that option is omitted.",
  "Outputs must be new absolute .sqlite paths outside this repository.",
  "Existing files are never overwritten. Existing output directories must be private (0700).",
  "Backup supports a running SQLite/WAL source. Verify/restore require a standalone snapshot.",
  "Restore writes a new file only; it never stops the app, changes DATABASE_PATH or deploys.",
].join("\n");

export class DatabaseBackupError extends Error {}

function absolute(value, label) {
  if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f]/.test(value) || !path.isAbsolute(value))
    throw new DatabaseBackupError(label + " must be an absolute filesystem path.");
  return path.resolve(value);
}

async function maybeStat(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function noSymlinkComponents(filename) {
  const parts = path.resolve(filename).split(path.sep).filter(Boolean);
  let current = path.parse(filename).root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await maybeStat(current);
    if (!stat) break;
    if (stat.isSymbolicLink())
      throw new DatabaseBackupError("Symlink paths are not supported for database recovery.");
  }
}

async function sourceFile(value, { standalone = false } = {}) {
  const filename = absolute(value, "Database");
  await noSymlinkComponents(filename);
  const stat = await maybeStat(filename);
  if (!stat || !stat.isFile())
    throw new DatabaseBackupError("The source database must already exist as a regular file.");
  for (const suffix of SIDECARS) {
    const sidecar = await maybeStat(filename + suffix);
    if (sidecar && (!sidecar.isFile() || sidecar.isSymbolicLink()))
      throw new DatabaseBackupError("Database journal sidecars must be regular files.");
    if (standalone && sidecar)
      throw new DatabaseBackupError("Use a standalone backup snapshot without journal, WAL or SHM sidecars.");
  }
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const header = Buffer.alloc(100);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 100 || header.subarray(0, 16).toString("binary") !== "SQLite format 3\0")
      throw new DatabaseBackupError("The source is not a readable SQLite database.");
    if (standalone && (header[18] !== 1 || header[19] !== 1))
      throw new DatabaseBackupError("Create a standalone backup before verification or restoration.");
  } finally { await handle.close(); }
  return filename;
}

async function hashFile(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function expectedChecksum(filename) {
  const sidecarPath = filename + ".sha256";
  await noSymlinkComponents(sidecarPath);
  const stat = await maybeStat(sidecarPath);
  if (!stat) return null;
  if (!stat.isFile() || stat.size > 512)
    throw new DatabaseBackupError("The checksum sidecar is not a valid regular checksum file.");
  const contents = await readFile(sidecarPath, "utf8");
  const match = /^([a-fA-F0-9]{64})  ([^\r\n]+)\r?\n?$/.exec(contents);
  if (!match || match[2] !== path.basename(filename))
    throw new DatabaseBackupError("The checksum sidecar does not identify this database file.");
  return match[1].toLowerCase();
}

function readonlyDatabase(filename) {
  const db = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
  db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;");
  return db;
}

function checkIntegrity(db) {
  let okay = false;
  for (const row of db.prepare("PRAGMA integrity_check").iterate()) {
    if (Object.values(row)[0] !== "ok")
      throw new DatabaseBackupError("SQLite integrity verification failed.");
    okay = true;
  }
  if (!okay) throw new DatabaseBackupError("SQLite integrity verification failed.");
  if (!db.prepare("PRAGMA foreign_key_check").iterate().next().done)
    throw new DatabaseBackupError("SQLite foreign-key verification failed.");
}

async function withVerifiedSnapshot(database, action) {
  const filename = await sourceFile(database, { standalone: true });
  const checksum = await expectedChecksum(filename);
  const db = readonlyDatabase(filename);
  try {
    db.exec("BEGIN");
    // Acquire the read lock before checking the exact standalone file.
    db.prepare("SELECT count(*) FROM sqlite_schema").get();
    const sha256 = await hashFile(filename);
    if (checksum && checksum !== sha256)
      throw new DatabaseBackupError("Database checksum verification failed. Do not restore this file.");
    checkIntegrity(db);
    await sourceFile(filename, { standalone: true });
    if (await hashFile(filename) !== sha256)
      throw new DatabaseBackupError("The database changed while it was being verified.");
    const result = { database: filename, bytes: (await lstat(filename)).size, sha256, verified: true, checksumVerified: checksum !== null };
    return action ? await action(db, result) : result;
  } finally {
    try { if (db.isTransaction) db.exec("ROLLBACK"); } finally { db.close(); }
  }
}

export async function verifyDatabase(database) {
  return withVerifiedSnapshot(database);
}

function inside(parent, filename) {
  const relative = path.relative(parent, filename);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

async function outputPath(value, source) {
  const filename = absolute(value, "Output");
  if (!filename.endsWith(".sqlite"))
    throw new DatabaseBackupError("Use a new output filename ending in .sqlite.");
  if (inside(await realpath(REPOSITORY), filename))
    throw new DatabaseBackupError("Recovery files must be outside the repository, public assets and release package.");
  if (filename === source)
    throw new DatabaseBackupError("The output must differ from the source database.");
  await noSymlinkComponents(filename);
  for (const candidate of [filename, filename + ".sha256", ...SIDECARS.map((suffix) => filename + suffix)])
    if (await maybeStat(candidate))
      throw new DatabaseBackupError("The output or one of its sidecars already exists. Choose a new filename.");
  const directory = path.dirname(filename);
  // Walk and create without following an existing symlink component.
  let current = path.parse(directory).root;
  for (const part of directory.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat = await maybeStat(current);
    if (!stat) {
      await mkdir(current, { mode: 0o700 });
      await chmod(current, 0o700);
      stat = await lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new DatabaseBackupError("The output directory must use real directories, without symlinks.");
  }
  if (((await lstat(directory)).mode & 0o777) !== 0o700)
    throw new DatabaseBackupError("The output directory must be private (0700). Use a dedicated backup directory.");
  return filename;
}

async function reserve(filename) {
  const handle = await open(filename, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    const stat = await handle.stat();
    return { filename, ino: stat.ino, dev: stat.dev };
  } finally { await handle.close(); }
}

async function removeOwned(files) {
  for (const owned of [...files].reverse()) {
    const stat = await maybeStat(owned.filename);
    if (stat && !stat.isSymbolicLink() && stat.ino === owned.ino && stat.dev === owned.dev)
      await unlink(owned.filename);
  }
}

async function writeSnapshot(db, source, output) {
  const filename = await outputPath(output, source);
  const owned = [];
  try {
    owned.push(await reserve(filename));
    owned.push(await reserve(filename + ".sha256"));
    await backup(db, filename);
    const copy = new DatabaseSync(filename);
    try {
      copy.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;");
      checkIntegrity(copy);
    } finally { copy.close(); }
    await sourceFile(filename, { standalone: true });
    const sha256 = await hashFile(filename);
    const checksum = await open(filename + ".sha256", constants.O_WRONLY | constants.O_NOFOLLOW);
    try {
      await checksum.writeFile(sha256 + "  " + path.basename(filename) + "\n");
      await checksum.sync();
    } finally { await checksum.close(); }
    const snapshot = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await snapshot.sync(); } finally { await snapshot.close(); }
    const directory = await open(path.dirname(filename), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
    // Include the checksum in the final verification before reporting success.
    return { ...await verifyDatabase(filename), checksumFile: filename + ".sha256" };
  } catch (error) {
    const current = owned[0] && await maybeStat(owned[0].filename);
    if (current && current.ino === owned[0].ino && current.dev === owned[0].dev)
      for (const suffix of SIDECARS) {
        const sidecar = await maybeStat(filename + suffix);
        if (sidecar?.isFile() && !sidecar.isSymbolicLink())
          owned.push({ filename: filename + suffix, ino: sidecar.ino, dev: sidecar.dev });
      }
    await removeOwned(owned);
    throw error;
  }
}

export async function backupDatabase(database, output) {
  const source = await sourceFile(database);
  const db = readonlyDatabase(source);
  try { return await writeSnapshot(db, source, output); }
  finally { db.close(); }
}

export async function restoreDatabase(database, output) {
  return withVerifiedSnapshot(database, (db, proof) => writeSnapshot(db, proof.database, output));
}

export async function runDatabaseCommand(argv, { env = process.env } = {}) {
  if (!Array.isArray(argv) || argv.some((part) => typeof part !== "string"))
    throw new DatabaseBackupError("Use a valid database recovery command.");
  if (argv.includes("--help") || (argv.length === 1 && argv[0] === "help")) return { help: HELP };
  const [command, ...args] = argv;
  if (!["backup", "verify", "restore"].includes(command))
    throw new DatabaseBackupError("Choose backup, verify or restore. Use --help for instructions.");
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!["--database", "--output"].includes(name) || !value || value.startsWith("--") || options[name] !== undefined)
      throw new DatabaseBackupError("Use each supported option once with its filesystem path.");
    options[name] = value;
  }
  const database = options["--database"] ?? env.DATABASE_PATH;
  if (command === "verify") {
    if (options["--output"]) throw new DatabaseBackupError("Verification does not accept an output path.");
    return { command, ...await verifyDatabase(database) };
  }
  if (!options["--output"]) throw new DatabaseBackupError("Supply --output with a new private absolute .sqlite path.");
  return { command, ...await (command === "backup" ? backupDatabase : restoreDatabase)(database, options["--output"]) };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runDatabaseCommand(process.argv.slice(2));
    process.stdout.write(result.help ? result.help + "\n" : JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write((error instanceof DatabaseBackupError ? error.message : "Database recovery failed. Check source integrity, access permissions and available disk space.") + "\n");
    process.exitCode = 1;
  }
}
