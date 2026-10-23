import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { createIdentityService, identityConfigFromEnv } from "../server/identity.mjs";

class HttpError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}
const STORAGE_KEY = "21".repeat(32);
const fixtureImage = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#88a040" } }).png().toBuffer();
const body = () => ({ identityConsent: true, document: { data: fixtureImage.toString("base64") }, selfie: { data: fixtureImage.toString("base64") } });

function fixture(overrides = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE members(id TEXT PRIMARY KEY)");
  const id = randomUUID();
  db.prepare("INSERT INTO members(id) VALUES (?)").run(id);
  let clock = Date.parse("2026-10-23T10:00:00.000Z");
  let application = { memberId: id, name: "Local Adult Fixture", birthDate: "2000-01-01", submittedAt: new Date(clock).toISOString(), status: "pending", identityRequired: true };
  const decisions = [];
  const options = {
    db, HttpError, config: { storageKey: STORAGE_KEY }, now: () => clock,
    getApplication: () => application && { ...application },
    recordDecision(value) { decisions.push(value); application.status = value.decision; application.birthDate = null; },
    ...overrides,
  };
  const service = createIdentityService(options);
  const reviewBody = (changes = {}) => ({ method: "uploaded_id_selfie", decision: "verified", expectedUploadId: service.status(id).uploadId, expectedSubmittedAt: application.submittedAt, identityChecked: true, ageChecked: true, ...changes });
  return { db, id, service, options, decisions, reviewBody, application: () => application,
    change: (values) => { application = { ...application, ...values }; }, advance: (ms) => { clock += ms; },
    close() { service.dispose(); db.close(); },
  };
}

test("private identity uploads fail closed without a separately configured encryption key", async () => {
  const f = fixture({ config: {} });
  try {
    assert.equal(f.service.configStatus().configured, false);
    assert.deepEqual(f.service.configStatus().missingSetup, ["IDENTITY_UPLOAD_KEY"]);
    assert.equal(f.service.status(f.id).status, "unavailable");
    assert.equal(f.service.status(f.id).automatedFaceVerification, false);
    await assert.rejects(f.service.submit(f.id, body()), { status: 503 });
    assert.equal(f.db.prepare("SELECT count(*) AS total FROM member_identity_uploads").get().total, 0);
    assert.deepEqual(identityConfigFromEnv({ IDENTITY_UPLOAD_KEY: STORAGE_KEY }), { storageKey: STORAGE_KEY });
  } finally { f.close(); }
});

test("ID and selfie are both required, sanitised to JPEG and authenticated-encrypted in the private database", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.submit(f.id, { ...body(), identityConsent: false }), { status: 422 });
    await assert.rejects(f.service.submit(f.id, { ...body(), selfie: undefined }), { status: 422 });
    const submitted = await f.service.submit(f.id, body());
    assert.equal(submitted.verification.status, "pending");
    assert.equal(submitted.verification.provider, "staff_review");
    assert.equal(submitted.verification.documentAvailable, true);
    assert.equal(submitted.verification.selfieAvailable, true);
    assert.equal(f.decisions.length, 0);
    for (const kind of ["document", "selfie"]) {
      const image = f.service.image(f.id, kind, submitted.verification.uploadId);
      assert.equal(image.contentType, "image/jpeg");
      const meta = await sharp(image.bytes).metadata();
      assert.equal(meta.format, "jpeg");
      assert.equal(meta.width, 640);
      assert.equal(meta.exif, undefined);
      assert.equal(meta.icc, undefined);
      assert.ok(!image.bytes.equals(fixtureImage));
      const row = f.db.prepare("SELECT * FROM member_identity_uploads").get();
      assert.ok(!Buffer.from(row[`${kind}_blob`]).equals(image.bytes));
      assert.ok(!Buffer.from(row[`${kind}_blob`]).includes(fixtureImage));
      const other = Buffer.from(row[`${kind}_blob`]);
      other[other.length - 1] ^= 1;
      f.db.prepare(`UPDATE member_identity_uploads SET ${kind}_blob=?`).run(other);
      assert.throws(() => f.service.image(f.id, kind), { status: 503 });
      f.db.prepare(`UPDATE member_identity_uploads SET ${kind}_blob=?`).run(row[`${kind}_blob`]);
    }
    const metadata = JSON.stringify(f.db.prepare("SELECT * FROM member_identity_uploads").all());
    for (const privateValue of ["Local Adult Fixture", "2000-01-01", STORAGE_KEY]) assert.ok(!metadata.includes(privateValue));
  } finally { f.close(); }
});

test("unsafe, disguised, oversized and unreadable identity images cannot enter storage", async () => {
  const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).png().toBuffer();
  const invalid = ["", "a==?", "<svg></svg>", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"/>').toString("base64"), tiny.toString("base64"), "A".repeat(8 * 1024 * 1024 + 4)];
  const f = fixture();
  try {
    for (const data of invalid) await assert.rejects(f.service.submit(f.id, { ...body(), document: { data } }), { status: 422 });
    assert.equal(f.db.prepare("SELECT count(*) AS total FROM member_identity_uploads").get().total, 0);
    assert.equal(f.decisions.length, 0);
  } finally { f.close(); }
});

test("manual approval requires current uploaded evidence, both attestations and the exact application/upload version", async () => {
  const f = fixture();
  try {
    assert.throws(() => f.service.review(f.id, f.reviewBody(), "staff-test"), { status: 409 });
    await f.service.submit(f.id, body());
    for (const changes of [{ identityChecked: false }, { ageChecked: false }, { method: "in_person" }, { note: "unnecessary ID number" }])
      assert.throws(() => f.service.review(f.id, f.reviewBody(changes), "staff-test"), { status: 422 });
    assert.throws(() => f.service.review(f.id, f.reviewBody({ expectedUploadId: randomUUID() }), "staff-test"), { status: 409 });
    assert.throws(() => f.service.review(f.id, f.reviewBody({ expectedSubmittedAt: "old" }), "staff-test"), { status: 409 });
    const verified = f.service.review(f.id, f.reviewBody(), "staff-test");
    assert.equal(verified.status, "verified");
    assert.equal(f.decisions.length, 1);
    assert.equal(f.decisions[0].method, "uploaded_id_selfie");
    assert.equal(f.application().birthDate, null);
    const stored = f.db.prepare("SELECT * FROM member_identity_uploads").get();
    assert.equal(stored.document_blob, null);
    assert.equal(stored.selfie_blob, null);
    assert.notEqual(stored.reviewer_ref, "staff-test");
    assert.throws(() => f.service.image(f.id, "document"), { status: 404 });
    assert.throws(() => f.service.review(f.id, f.reviewBody(), "staff-test"), { status: 409 });
  } finally { f.close(); }
});

test("rejection removes both images, accepts only privacy-safe reasons and preserves a truthful unverified state", async () => {
  const f = fixture();
  try {
    await f.service.submit(f.id, body());
    assert.throws(() => f.service.review(f.id, f.reviewBody({ decision: "rejected", reason: "arbitrary personal note" }), "staff-test"), { status: 422 });
    const rejected = f.service.review(f.id, f.reviewBody({ decision: "rejected", reason: "details_mismatch" }), "staff-test");
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.documentAvailable, false);
    assert.equal(rejected.selfieAvailable, false);
    assert.equal(f.application().birthDate, null);
    await assert.rejects(f.service.submit(f.id, body()), { status: 409 });
  } finally { f.close(); }
});

test("replacement uploads and changed identity details invalidate stale staff approvals and purge superseded images", async () => {
  const f = fixture();
  try {
    const first = await f.service.submit(f.id, body());
    const stale = f.reviewBody();
    f.advance(1);
    const next = await f.service.submit(f.id, body());
    assert.notEqual(next.verification.uploadId, first.verification.uploadId);
    assert.throws(() => f.service.image(f.id, "selfie", first.verification.uploadId), { status: 404 });
    assert.throws(() => f.service.review(f.id, stale, "staff-test"), { status: 409 });
    const old = f.db.prepare("SELECT * FROM member_identity_uploads WHERE id=?").get(first.verification.uploadId);
    assert.equal(old.status, "superseded"); assert.equal(old.document_blob, null); assert.equal(old.selfie_blob, null);
    f.change({ name: "Changed Member", status: "required" });
    assert.equal(f.service.status(f.id).status, "not_started");
    assert.equal(f.db.prepare("SELECT document_blob FROM member_identity_uploads WHERE id=?").get(next.verification.uploadId).document_blob, null);
    assert.equal(f.decisions.length, 0);
  } finally { f.close(); }
});

test("seven-day pending expiry clears encrypted photos and closes the current age-check application", async () => {
  const f = fixture();
  try {
    await f.service.submit(f.id, body());
    f.advance(7 * 24 * 60 * 60 * 1000);
    assert.equal(f.service.status(f.id).status, "expired");
    assert.equal(f.decisions.length, 1);
    assert.equal(f.decisions[0].decision, "rejected");
    assert.equal(f.application().birthDate, null);
    const row = f.db.prepare("SELECT * FROM member_identity_uploads").get();
    assert.equal(row.document_blob, null); assert.equal(row.selfie_blob, null);
    assert.throws(() => f.service.image(f.id, "document"), { status: 404 });
  } finally { f.close(); }
});

test("storage restarts preserve evidence; missing or changed keys cannot destroy pending uploads or expose images", async () => {
  const f = fixture();
  const extra = [];
  try {
    await f.service.submit(f.id, body());
    const original = f.service.image(f.id, "document").bytes;
    const unconfigured = createIdentityService({ ...f.options, config: {} }); extra.push(unconfigured);
    assert.equal(unconfigured.status(f.id).status, "unavailable");
    assert.ok(f.db.prepare("SELECT document_blob FROM member_identity_uploads").get().document_blob);
    const wrong = createIdentityService({ ...f.options, config: { storageKey: "32".repeat(32) } }); extra.push(wrong);
    assert.equal(wrong.status(f.id).status, "unavailable");
    assert.ok(f.db.prepare("SELECT document_blob FROM member_identity_uploads").get().document_blob);
    assert.throws(() => wrong.image(f.id, "document"), { status: 503 });
    const restored = createIdentityService(f.options); extra.push(restored);
    assert.equal(restored.status(f.id).status, "pending");
    assert.deepEqual(restored.image(f.id, "document").bytes, original);
    f.db.prepare("DELETE FROM members WHERE id=?").run(f.id);
    assert.equal(f.db.prepare("SELECT count(*) AS total FROM member_identity_uploads").get().total, 0);
  } finally { extra.forEach((service) => service.dispose()); f.close(); }
});

test("a failed age-audit callback rolls back image purging and the review decision atomically", async () => {
  const f = fixture({ recordDecision() { throw new Error("Local simulated audit failure"); } });
  try {
    await f.service.submit(f.id, body());
    assert.throws(() => f.service.review(f.id, f.reviewBody(), "staff-test"), /audit failure/);
    assert.equal(f.service.status(f.id).status, "pending");
    assert.ok(f.service.image(f.id, "document").bytes);
  } finally { f.close(); }
});

test("a revoked member session during image decoding cannot commit private identity images", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.submit(f.id, body(), {
      assertAuthorized() { throw new HttpError(401, "Local simulated revoked member session"); },
    }), { status: 401 });
    assert.equal(f.db.prepare("SELECT count(*) AS total FROM member_identity_uploads").get().total, 0);
  } finally { f.close(); }
});

test("seven-day image retention still purges expired ciphertext while a storage key is temporarily missing", async () => {
  const f = fixture();
  let missing;
  try {
    await f.service.submit(f.id, body());
    missing = createIdentityService({ ...f.options, config: {} });
    f.advance(7 * 24 * 60 * 60 * 1000);
    missing.cleanup();
    const row = f.db.prepare("SELECT * FROM member_identity_uploads").get();
    assert.equal(row.status, "expired");
    assert.equal(row.document_blob, null); assert.equal(row.selfie_blob, null);
    assert.equal(f.decisions.length, 0);
  } finally { missing?.dispose(); f.close(); }
});
