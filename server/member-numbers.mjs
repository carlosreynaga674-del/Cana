import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_ASSIGNMENT_ATTEMPTS = 16;

function newNumber() {
  // Uniform, nonsequential identifiers. These are references, never credentials.
  const characters = [...randomBytes(12)].map((byte) => ALPHABET[byte & 31]);
  return `LC-${characters.slice(0, 4).join("")}-${characters.slice(4, 8).join("")}-${characters.slice(8).join("")}`;
}

/** Stable private account references, independent of government ID and eligibility. */
export function createMemberNumbers({ db, HttpError } = {}) {
  if (!db || typeof HttpError !== "function")
    throw new TypeError("A database and HTTP error type are required.");

  const ownsMigration = !db.isTransaction;
  if (ownsMigration) db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS member_numbers (
        member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
        number TEXT NOT NULL UNIQUE
      );
    `);
    const byMember = db.prepare("SELECT number FROM member_numbers WHERE member_id=?");
    const memberExists = db.prepare("SELECT id FROM members WHERE id=?");
    const insert = db.prepare(
      "INSERT INTO member_numbers (member_id,number) VALUES (?,?) ON CONFLICT(number) DO NOTHING",
    );

    function get(memberId) {
      if (typeof memberId !== "string" || !memberId.length) return null;
      return byMember.get(memberId)?.number || null;
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
        for (let attempt = 0; !number && attempt < MAX_ASSIGNMENT_ATTEMPTS; attempt += 1) {
          const candidate = newNumber();
          if (insert.run(memberId, candidate).changes === 1) number = candidate;
        }
        if (!number)
          throw new HttpError(503, "Membership numbers are temporarily unavailable. Please try again.");
        if (ownsTransaction) db.exec("COMMIT");
        return number;
      } catch (error) {
        if (ownsTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }

    // Backfill existing accounts atomically, retaining every previously issued number.
    const missing = db.prepare(
      "SELECT m.id FROM members m LEFT JOIN member_numbers n ON n.member_id=m.id WHERE n.member_id IS NULL ORDER BY m.id",
    ).all();
    for (const member of missing) assign(member.id);
    if (ownsMigration) db.exec("COMMIT");
    return { assign, get };
  } catch (error) {
    if (ownsMigration) db.exec("ROLLBACK");
    throw error;
  }
}
