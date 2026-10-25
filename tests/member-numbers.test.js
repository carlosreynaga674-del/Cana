import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemberNumbers } from "../server/member-numbers.mjs";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const FORMAT = /^LC-\d{6}$/;

function database(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL);");
  return db;
}

function insertMember(db, id) {
  db.prepare("INSERT INTO members (id,name) VALUES (?,?)").run(id, "Local synthetic member");
}

test("existing accounts receive unique nonsequential references without copying personal information", (t) => {
  const db = database();
  t.after(() => db.close());
  for (let index = 0; index < 250; index += 1) insertMember(db, `local-member-${index}`);
  const numbers = createMemberNumbers({ db, HttpError });
  const values = db.prepare("SELECT member_id,number FROM member_numbers").all();
  assert.equal(values.length, 250);
  assert.equal(new Set(values.map((row) => row.number)).size, 250);
  for (const row of values) {
    assert.match(row.number, FORMAT);
    assert.equal(numbers.get(row.member_id), row.number);
    assert.equal(numbers.assign(row.member_id), row.number);
    assert.ok(!row.number.includes("Local synthetic member"));
  }
  assert.deepEqual(db.prepare("PRAGMA table_info(member_numbers)").all().map((column) => column.name), ["member_id", "number"]);
  assert.deepEqual(db.prepare("PRAGMA table_info(member_number_aliases)").all().map((column) => column.name), ["number", "member_id"]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM member_number_aliases").get().count, 250);
  assert.equal(db.isTransaction, false);
});

test("issued numbers survive a database restart and only missing accounts are backfilled", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cana-member-numbers-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "local.sqlite");
  let db = database(filename);
  insertMember(db, "first");
  const original = createMemberNumbers({ db, HttpError }).get("first");
  insertMember(db, "later");
  db.close();
  db = database(filename);
  t.after(() => db.close());
  const restarted = createMemberNumbers({ db, HttpError });
  assert.equal(restarted.get("first"), original);
  assert.match(restarted.get("later"), FORMAT);
  assert.notEqual(restarted.get("later"), original);
  assert.equal(createMemberNumbers({ db, HttpError }).get("first"), original);
  assert.equal(db.prepare("SELECT count(*) AS count FROM member_numbers").get().count, 2);
});

test("signup assignment participates in its caller's transaction and cannot outlive a rolled-back account", (t) => {
  const db = database();
  t.after(() => db.close());
  const numbers = createMemberNumbers({ db, HttpError });
  db.exec("BEGIN IMMEDIATE");
  insertMember(db, "rolled-back");
  assert.match(numbers.assign("rolled-back"), FORMAT);
  assert.equal(db.isTransaction, true);
  db.exec("ROLLBACK");
  assert.equal(numbers.get("rolled-back"), null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM members").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM member_number_aliases").get().count, 0);
  insertMember(db, "committed");
  assert.match(numbers.assign("committed"), FORMAT);
  assert.equal(db.isTransaction, false);
});

test("account deletion removes its live reference but reserves the issued number without retaining an account link", (t) => {
  const db = database();
  t.after(() => db.close());
  insertMember(db, "deleted");
  const numbers = createMemberNumbers({ db, HttpError });
  const original = numbers.get("deleted");
  assert.match(original, FORMAT);
  db.prepare("DELETE FROM members WHERE id=?").run("deleted");
  assert.equal(numbers.get("deleted"), null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM member_numbers").get().count, 0);
  assert.equal(db.prepare("SELECT member_id FROM member_number_aliases WHERE number=?").get(original).member_id, null);
  for (const id of ["missing", "", undefined, null]) {
    assert.equal(numbers.get(id), null);
    assert.throws(() => numbers.assign(id), (error) => error instanceof HttpError && error.status === 404);
  }
  assert.equal(db.isTransaction, false);
  insertMember(db, "replacement");
  const restarted = createMemberNumbers({ db, HttpError, randomNumber: () => Number(original.slice(3)) });
  assert.match(restarted.get("replacement"), FORMAT);
  assert.notEqual(restarted.get("replacement"), original, "A new account cannot inherit a deleted account's barcode.");
});

test("a failed startup backfill rolls all new references back while preserving previously issued references", (t) => {
  const db = database();
  t.after(() => db.close());
  for (const id of ["existing", "first", "second"]) insertMember(db, id);
  db.exec(`
    CREATE TABLE member_numbers (member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE, number TEXT NOT NULL UNIQUE);
    INSERT INTO member_numbers VALUES ('existing','LC-0123-4567-89AB');
    CREATE TRIGGER reject_backfill BEFORE INSERT ON member_numbers WHEN NEW.member_id='second'
    BEGIN SELECT RAISE(ABORT,'Local backfill fixture failure'); END;
  `);
  assert.throws(() => createMemberNumbers({ db, HttpError }), /Local backfill fixture failure/);
  assert.equal(db.isTransaction, false);
  assert.deepEqual(db.prepare("SELECT member_id,number FROM member_numbers").all().map((row) => ({ ...row })), [
    { member_id: "existing", number: "LC-0123-4567-89AB" },
  ]);
  db.exec("DROP TRIGGER reject_backfill");
  const numbers = createMemberNumbers({ db, HttpError });
  assert.match(numbers.get("existing"), FORMAT);
  assert.notEqual(numbers.get("existing"), "LC-0123-4567-89AB");
  assert.equal(db.prepare("SELECT member_id FROM member_number_aliases WHERE number=?").get("LC-0123-4567-89AB").member_id, "existing");
  assert.match(numbers.get("first"), FORMAT);
  assert.match(numbers.get("second"), FORMAT);
});

test("bounded allocation failures leave no partial assignment or open transaction", (t) => {
  const db = database();
  t.after(() => db.close());
  const numbers = createMemberNumbers({ db, HttpError });
  insertMember(db, "unavailable");
  db.exec("CREATE TRIGGER ignore_allocation BEFORE INSERT ON member_numbers BEGIN SELECT RAISE(IGNORE); END;");
  assert.throws(() => numbers.assign("unavailable"), (error) => error instanceof HttpError && error.status === 503);
  assert.equal(numbers.get("unavailable"), null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM member_number_aliases").get().count, 0);
  assert.equal(db.isTransaction, false);
  db.exec("DROP TRIGGER ignore_allocation");
  assert.match(numbers.assign("unavailable"), FORMAT);
});

test("legacy cards migrate atomically to short numbers while old aliases still resolve and existing short numbers stay stable", (t) => {
  const db = database();
  t.after(() => db.close());
  for (const id of ["legacy-a", "legacy-b", "numeric"]) insertMember(db, id);
  db.exec(
    "CREATE TABLE member_numbers (member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE, number TEXT NOT NULL UNIQUE);" +
    "INSERT INTO member_numbers VALUES ('legacy-a','LC-0123-ABCD-WXYZ'),('legacy-b','LC-HJKM-NPQR-STVW'),('numeric','LC-000000');",
  );
  const numbers = createMemberNumbers({ db, HttpError, randomNumber: () => 0 });
  assert.equal(numbers.get("numeric"), "LC-000000");
  assert.equal(numbers.get("legacy-a"), "LC-000001");
  assert.equal(numbers.get("legacy-b"), "LC-000002");
  for (const [oldNumber, id] of [["LC-0123-ABCD-WXYZ", "legacy-a"], ["LC-HJKM-NPQR-STVW", "legacy-b"]]) {
    const matched = db.prepare(
      "SELECT m.id,n.number FROM member_number_aliases a JOIN members m ON m.id=a.member_id JOIN member_numbers n ON n.member_id=m.id WHERE a.number=?",
    ).get(oldNumber);
    assert.equal(matched.id, id);
    assert.equal(matched.number, numbers.get(id));
  }
  const secondStart = createMemberNumbers({ db, HttpError });
  assert.equal(secondStart.get("legacy-a"), "LC-000001");
  assert.equal(secondStart.get("legacy-b"), "LC-000002");
  db.prepare("DELETE FROM members WHERE id='legacy-a'").run();
  assert.equal(db.prepare("SELECT member_id FROM member_number_aliases WHERE number='LC-0123-ABCD-WXYZ'").get().member_id, null);
  assert.equal(db.prepare("SELECT member_id FROM member_number_aliases WHERE number='LC-000001'").get().member_id, null);
});

test("a conflicting reserved alias cannot be reassigned during migration", (t) => {
  const db = database();
  t.after(() => db.close());
  for (const id of ["first", "second"]) insertMember(db, id);
  db.exec(
    "CREATE TABLE member_numbers (member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE, number TEXT NOT NULL UNIQUE);" +
    "CREATE TABLE member_number_aliases (number TEXT PRIMARY KEY, member_id TEXT REFERENCES members(id) ON DELETE SET NULL);" +
    "INSERT INTO member_numbers VALUES ('first','LC-0123-ABCD-WXYZ');" +
    "INSERT INTO member_number_aliases VALUES ('LC-0123-ABCD-WXYZ','second');",
  );
  assert.throws(() => createMemberNumbers({ db, HttpError }), (error) => error.status === 503);
  assert.equal(db.isTransaction, false);
  assert.equal(db.prepare("SELECT number FROM member_numbers WHERE member_id='first'").get().number, "LC-0123-ABCD-WXYZ");
  assert.equal(db.prepare("SELECT member_id FROM member_number_aliases").get().member_id, "second");
});
