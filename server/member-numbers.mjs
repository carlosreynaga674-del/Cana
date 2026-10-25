import { randomInt } from "node:crypto";

const NUMBER_SPACE = 1_000_000;
const FORMAT = /^LC-\d{6}$/;
const NUMERIC_GLOB = "LC-[0-9][0-9][0-9][0-9][0-9][0-9]";
const MAX_ASSIGNMENT_ATTEMPTS = 32;
const formatNumber = (value) => "LC-" + String(value).padStart(6, "0");

/** Account references only. Issued numbers remain reserved after deletion. */
export function createMemberNumbers({
  db, HttpError, randomNumber = () => randomInt(NUMBER_SPACE),
} = {}) {
  if (!db || typeof HttpError !== "function" || typeof randomNumber !== "function")
    throw new TypeError("A database, HTTP error type and random number source are required.");

  const ownsMigration = !db.isTransaction;
  if (ownsMigration) db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS member_numbers (" +
        "member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE," +
        "number TEXT NOT NULL UNIQUE);" +
      "CREATE TABLE IF NOT EXISTS member_number_aliases (" +
        "number TEXT PRIMARY KEY," +
        "member_id TEXT REFERENCES members(id) ON DELETE SET NULL);" +
      "CREATE INDEX IF NOT EXISTS member_number_alias_member ON member_number_aliases(member_id);",
    );
    const byMember = db.prepare("SELECT number FROM member_numbers WHERE member_id=?");
    const memberExists = db.prepare("SELECT id FROM members WHERE id=?");
    const alias = db.prepare("SELECT member_id FROM member_number_aliases WHERE number=?");
    const reserve = db.prepare("INSERT INTO member_number_aliases (number,member_id) VALUES (?,?)");
    const writeNumber = db.prepare(
      "INSERT INTO member_numbers (member_id,number) VALUES (?,?) " +
      "ON CONFLICT(member_id) DO UPDATE SET number=excluded.number " +
      "ON CONFLICT(number) DO NOTHING",
    );
    const issuedNumeric = db.prepare(
      "SELECT number FROM member_number_aliases WHERE number GLOB ? ORDER BY number",
    );
    const countNumeric = db.prepare(
      "SELECT count(*) AS count FROM member_number_aliases WHERE number GLOB ?",
    );
    const unavailable = () => new HttpError(
      503, "Membership numbers are unavailable. Please contact the administrator.",
    );

    function reserveExisting(number, memberId) {
      const existing = alias.get(number);
      if (existing) {
        if (existing.member_id !== memberId) throw unavailable();
      } else reserve.run(number, memberId);
    }

    function get(memberId) {
      if (typeof memberId !== "string" || !memberId.length) return null;
      return byMember.get(memberId)?.number || null;
    }

    function firstAvailable() {
      let value = 0;
      for (const row of issuedNumeric.iterate(NUMERIC_GLOB)) {
        const issued = Number(row.number.slice(3));
        if (issued > value) break;
        if (issued === value) value += 1;
      }
      return value < NUMBER_SPACE ? formatNumber(value) : null;
    }

    function assign(memberId) {
      if (typeof memberId !== "string" || !memberId.length)
        throw new HttpError(404, "Member not found.");
      const ownsTransaction = !db.isTransaction;
      if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
      try {
        if (!memberExists.get(memberId))
          throw new HttpError(404, "Member not found.");
        let number = get(memberId);
        if (number) reserveExisting(number, memberId);
        if (!FORMAT.test(number || "")) {
          if (countNumeric.get(NUMERIC_GLOB).count >= NUMBER_SPACE) throw unavailable();
          const tryNumber = (candidate) => {
            if (!candidate || alias.get(candidate)) return false;
            if (writeNumber.run(memberId, candidate).changes !== 1) return false;
            reserve.run(candidate, memberId);
            number = candidate;
            return true;
          };
          let allocated = false;
          for (let attempt = 0; !allocated && attempt < MAX_ASSIGNMENT_ATTEMPTS; attempt += 1) {
            const value = randomNumber();
            if (!Number.isInteger(value) || value < 0 || value >= NUMBER_SPACE)
              throw unavailable();
            allocated = tryNumber(formatNumber(value));
          }
          if (!allocated) allocated = tryNumber(firstAvailable());
          if (!allocated) throw unavailable();
        }
        if (ownsTransaction) db.exec("COMMIT");
        return number;
      } catch (error) {
        if (ownsTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }

    // Reserve all old references first, including numeric references that must
    // remain stable. Migration never changes a code to one already issued.
    for (const row of db.prepare("SELECT member_id,number FROM member_numbers ORDER BY member_id").all())
      reserveExisting(row.number, row.member_id);
    for (const member of db.prepare("SELECT id FROM members ORDER BY id").all())
      assign(member.id);
    if (ownsMigration) db.exec("COMMIT");
    return { assign, get };
  } catch (error) {
    if (ownsMigration) db.exec("ROLLBACK");
    throw error;
  }
}
