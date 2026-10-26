import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createIdentityService } from "../server/identity.mjs";
import { createOnboarding } from "../server/onboarding.mjs";
import { createProductMedia } from "../server/product-media.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PRIVATE_FAILURE = "local-private-id@example.test /private/fixture.sqlite";
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function fixture(t) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const warnings = t.mock.method(console, "warn", () => {});
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE members(id TEXT PRIMARY KEY); INSERT INTO members VALUES ('fixture-member');");
  t.after(() => db.close());
  return { db, warnings };
}

test("identity maintenance survives a failed purge, retries, and stops after disposal while request/startup cleanup still fails closed", (t) => {
  const { db, warnings } = fixture(t);
  const options = { db, HttpError, config: {}, getApplication: () => null, recordDecision() { throw new Error("No application is present."); } };
  const service = createIdentityService(options);
  t.after(() => service.dispose());
  const insert = (id) => db.prepare("INSERT INTO member_identity_uploads (id,member_id,submitted_at,name_binding,birth_binding,document_blob,selfie_blob,status,consent_at,uploaded_at,expires_at) VALUES (?,'fixture-member',?,'binding','binding',?,?,'pending',?,?,?)")
    .run(id, new Date(Date.now() - 8 * DAY).toISOString(), Buffer.from("fixture document"), Buffer.from("fixture selfie"), "fixture-consent", "fixture-upload", Date.now() - DAY);
  insert("expired-identity-fixture");
  db.exec("CREATE TRIGGER reject_identity_purge BEFORE UPDATE ON member_identity_uploads BEGIN SELECT RAISE(ABORT,'" + PRIVATE_FAILURE + "'); END;");
  assert.doesNotThrow(() => t.mock.timers.tick(HOUR));
  assert.deepEqual(warnings.mock.calls.map((call) => call.arguments), [["Identity retention maintenance failed; it will retry on the next scheduled run."]]);
  assert.equal(db.isTransaction, false, "The failed purge must not leave its transaction open.");
  const pending = db.prepare("SELECT status,document_blob,selfie_blob FROM member_identity_uploads WHERE id=?").get("expired-identity-fixture");
  assert.equal(pending.status, "pending");
  assert.ok(pending.document_blob && pending.selfie_blob);
  assert.throws(() => service.status("fixture-member"), /local-private-id/);
  assert.throws(() => createIdentityService(options), /local-private-id/);
  assert.equal(warnings.mock.callCount(), 1, "Only background failures are swallowed and diagnosed.");
  db.exec("DROP TRIGGER reject_identity_purge");
  t.mock.timers.tick(HOUR);
  const purged = db.prepare("SELECT status,document_blob,selfie_blob FROM member_identity_uploads WHERE id=?").get("expired-identity-fixture");
  assert.deepEqual({ ...purged }, { status: "expired", document_blob: null, selfie_blob: null });
  assert.equal(warnings.mock.callCount(), 1);
  insert("disposed-identity-fixture");
  service.dispose();
  t.mock.timers.tick(HOUR);
  assert.equal(db.prepare("SELECT status FROM member_identity_uploads WHERE id=?").get("disposed-identity-fixture").status, "pending");
});

test("onboarding maintenance retries failed birth-date retention without crashing and stops when closed", (t) => {
  const { db, warnings } = fixture(t);
  const options = { db, HttpError, production: false };
  const service = createOnboarding(options);
  t.after(() => service.close());
  const seed = () => db.prepare("INSERT OR REPLACE INTO member_age_checks (member_id,status,birth_date,submitted_at,policy_version) VALUES ('fixture-member','pending','2000-01-01',?,'fixture-policy')")
    .run(new Date(Date.now() - 31 * DAY).toISOString());
  seed();
  db.exec("CREATE TRIGGER reject_onboarding_retention BEFORE UPDATE ON member_age_checks BEGIN SELECT RAISE(ABORT,'" + PRIVATE_FAILURE + "'); END;");
  assert.doesNotThrow(() => t.mock.timers.tick(HOUR));
  assert.deepEqual(warnings.mock.calls.map((call) => call.arguments), [["Onboarding retention maintenance failed; it will retry on the next scheduled run."]]);
  assert.equal(db.isTransaction, false);
  assert.equal(db.prepare("SELECT status FROM member_age_checks WHERE member_id='fixture-member'").get().status, "pending");
  assert.throws(() => service.publicAge("fixture-member"), /local-private-id/);
  assert.throws(() => createOnboarding(options), /local-private-id/);
  assert.equal(warnings.mock.callCount(), 1);
  db.exec("DROP TRIGGER reject_onboarding_retention");
  t.mock.timers.tick(HOUR);
  assert.deepEqual({ ...db.prepare("SELECT status,birth_date FROM member_age_checks WHERE member_id='fixture-member'").get() }, { status: "required", birth_date: null });
  assert.equal(warnings.mock.callCount(), 1);
  seed();
  service.close();
  t.mock.timers.tick(HOUR);
  assert.equal(db.prepare("SELECT status FROM member_age_checks WHERE member_id='fixture-member'").get().status, "pending");
});

test("product-photo maintenance retries orphan removal, keeps request/startup failures visible and stops when closed", async (t) => {
  const { db, warnings } = fixture(t);
  const options = { db, HttpError };
  const service = createProductMedia(options);
  t.after(() => service.close());
  const insert = (id) => db.prepare("INSERT INTO product_media (id,url,image_blob,byte_size,content_hash,actor_ref,created_at) VALUES (?,?,?,1,'fixture-hash','fixture-actor',?)")
    .run(id, "/media/products/" + id + ".webp", Buffer.from("x"), new Date(Date.now() - 2 * DAY).toISOString());
  insert("expired-product-photo-fixture");
  db.exec("CREATE TRIGGER reject_product_photo_purge BEFORE DELETE ON product_media BEGIN SELECT RAISE(ABORT,'" + PRIVATE_FAILURE + "'); END;");
  assert.doesNotThrow(() => t.mock.timers.tick(HOUR));
  assert.deepEqual(warnings.mock.calls.map((call) => call.arguments), [["Product photo maintenance failed; it will retry on the next scheduled run."]]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM product_media").get().count, 1);
  await assert.rejects(service.upload({ image: { data: "invalid" } }, "fixture-actor"), /local-private-id/);
  assert.throws(() => createProductMedia(options), /local-private-id/);
  assert.equal(warnings.mock.callCount(), 1);
  db.exec("DROP TRIGGER reject_product_photo_purge");
  t.mock.timers.tick(HOUR);
  assert.equal(db.prepare("SELECT count(*) AS count FROM product_media").get().count, 0);
  assert.equal(warnings.mock.callCount(), 1);
  insert("closed-product-photo-fixture");
  service.close();
  t.mock.timers.tick(HOUR);
  assert.equal(db.prepare("SELECT count(*) AS count FROM product_media").get().count, 1);
});
