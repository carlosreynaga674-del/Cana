import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { validateBirthDate } from "./onboarding.mjs";

const FILE_BYTES = 6 * 1024 * 1024;
const IMAGE_PIXELS = 20_000_000;
const PENDING_MS = 7 * 24 * 60 * 60 * 1000;
const reasons = new Set(["identity_not_confirmed", "details_mismatch", "unable_to_verify"]);
const clean = (value) => typeof value === "string" ? value.trim() : "";
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const normalizedName = (value) => clean(value).normalize("NFKC").toLocaleLowerCase("en-ZA").replace(/[^\p{L}\p{N}]/gu, "");

export function identityConfigFromEnv(env = process.env) {
  return { storageKey: clean(env.IDENTITY_UPLOAD_KEY) };
}

/**
 * Private ID + selfie submissions for a human staff comparison. No automated
 * facial matching, liveness check, third-party transfer, or public media URL.
 * The host owns authentication and its age-check audit through synchronous callbacks.
 */
export function createIdentityService({
  db, HttpError, config = identityConfigFromEnv(), getApplication, recordDecision,
  onSubmitted = () => {}, onReviewed = () => {},
  now = () => Date.now(),
}) {
  const keyText = clean(config.storageKey);
  const configured = /^[a-f0-9]{64}$/i.test(keyText);
  const key = configured ? Buffer.from(keyText, "hex") : null;
  const keyId = configured ? createHash("sha256").update(key).digest("hex") : "";
  let disposed = false;
  let activeSubmissions = 0;
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_identity_uploads (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      submitted_at TEXT NOT NULL,
      name_binding TEXT NOT NULL,
      birth_binding TEXT NOT NULL,
      document_blob BLOB,
      selfie_blob BLOB,
      status TEXT NOT NULL,
      reason TEXT,
      consent_at TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      reviewed_at TEXT,
      reviewer_ref TEXT
    );
    CREATE INDEX IF NOT EXISTS identity_upload_member
      ON member_identity_uploads(member_id,uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS identity_upload_expiry
      ON member_identity_uploads(status,expires_at);
  `);
  if (!db.prepare("PRAGMA table_info(member_identity_uploads)").all().some((column) => column.name === "key_id"))
    db.exec("ALTER TABLE member_identity_uploads ADD COLUMN key_id TEXT NOT NULL DEFAULT ''");
  const latest = (memberId) => db.prepare(
    "SELECT * FROM member_identity_uploads WHERE member_id=? ORDER BY rowid DESC LIMIT 1",
  ).get(memberId);
  const binding = (value) => createHmac("sha256", key).update(value).digest("hex");
  const sameApplication = (upload, application) => Boolean(
    configured && upload.key_id === keyId && application?.identityRequired &&
    upload.submitted_at === application.submittedAt &&
    binding(normalizedName(application.name)) === upload.name_binding &&
    (!application.birthDate || binding(application.birthDate) === upload.birth_binding) &&
    ["pending", "verified", "rejected"].includes(application.status),
  );
  function transaction(operation) {
    const outer = db.isTransaction;
    if (!outer) db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      if (!outer) db.exec("COMMIT");
      return result;
    } catch (error) {
      if (!outer) db.exec("ROLLBACK");
      throw error;
    }
  }
  function configStatus() {
    return {
      provider: "staff_review", configured,
      missingSetup: configured ? [] : ["IDENTITY_UPLOAD_KEY"],
      documentUploadRequired: true, selfieRequired: true,
      automatedFaceVerification: false,
      maxFileBytes: FILE_BYTES,
    };
  }
  function requireConfiguration() {
    if (!configured) throw new HttpError(503,
      "Secure ID storage is not configured yet. Please contact the store; no identity images have been accepted.");
  }
  function encrypt(bytes, id, kind) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`${id}\n${kind}`));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }
  function decrypt(bytes, id, kind) {
    try {
      const buffer = Buffer.from(bytes);
      const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${id}\n${kind}`));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]);
    } catch {
      throw new HttpError(503, "This identity image cannot be decrypted. The store must check its secure storage configuration.");
    }
  }
  function cleanup(memberId) {
    if (disposed) return;
    const expired = db.prepare(
      `SELECT * FROM member_identity_uploads WHERE status='pending' AND expires_at<=? ${memberId ? "AND member_id=?" : ""}`,
    ).all(...(memberId ? [now(), memberId] : [now()]));
    for (const upload of expired) transaction(() => {
      // Expiry must not revoke a replacement application or another completed review.
      const application = getApplication(upload.member_id);
      if (sameApplication(upload, application) && application.status === "pending" &&
        latest(upload.member_id)?.id === upload.id)
        recordDecision({
          memberId: upload.member_id, submittedAt: upload.submitted_at,
          decision: "rejected", method: "uploaded_id_selfie", reason: "unable_to_verify",
          uploadId: upload.id, providerSessionId: upload.id,
          reviewerRef: "system:identity-upload-expiry",
          decisionAt: new Date(now()).toISOString(),
        });
      db.prepare("UPDATE member_identity_uploads SET status='expired',reason='expired',document_blob=NULL,selfie_blob=NULL WHERE id=?")
        .run(upload.id);
    });
    // Retention does not require decryption. A temporarily missing key must
    // still permit TTL purging, but cannot invalidate unexpired submissions.
    if (!configured) return;
    // Superseded applications do not need retained images, even before their TTL.
    const pending = db.prepare(`SELECT * FROM member_identity_uploads WHERE status='pending' AND key_id=? ${memberId ? "AND member_id=?" : ""}`)
      .all(...(memberId ? [keyId, memberId] : [keyId]));
    for (const upload of pending) {
      if (!sameApplication(upload, getApplication(upload.member_id)) || latest(upload.member_id)?.id !== upload.id)
        db.prepare("UPDATE member_identity_uploads SET status='superseded',document_blob=NULL,selfie_blob=NULL WHERE id=?")
          .run(upload.id);
    }
  }
  function status(memberId) {
    cleanup(memberId);
    const application = getApplication(memberId);
    const required = application?.identityRequired === true;
    const upload = latest(memberId);
    const result = {
      required, provider: "staff_review", configured,
      status: required ? (configured ? "not_started" : "unavailable") : "not_required",
      uploadId: null, submittedAt: application?.submittedAt || null,
      uploadedAt: null, expiresAt: null, reviewedAt: null,
      documentAvailable: false, selfieAvailable: false,
      automatedFaceVerification: false, reason: null,
    };
    if (required && configured && upload?.status === "pending" && upload.key_id !== keyId) {
      result.status = "unavailable";
      result.reason = "storage_key_changed";
    }
    if (required && upload && sameApplication(upload, application)) {
      result.status = upload.status === "superseded" ? "not_started" : upload.status;
      result.uploadId = upload.id;
      result.uploadedAt = upload.uploaded_at;
      result.expiresAt = new Date(upload.expires_at).toISOString();
      result.reviewedAt = upload.reviewed_at;
      result.reason = upload.reason;
      result.documentAvailable = upload.status === "pending" && Boolean(upload.document_blob);
      result.selfieAvailable = upload.status === "pending" && Boolean(upload.selfie_blob);
    }
    return result;
  }
  async function imageBytes(value, field) {
    if (!record(value) || typeof value.data !== "string" ||
      value.data.length > Math.ceil(FILE_BYTES / 3) * 4 ||
      value.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))
      throw new HttpError(422, "Upload a JPEG, PNG or WebP image of at most 6 MB.", { [field]: "Choose a valid image of at most 6 MB." });
    const input = Buffer.from(value.data, "base64");
    if (input.length < 100 || input.length > FILE_BYTES)
      throw new HttpError(422, "Choose a readable JPEG, PNG or WebP image of at most 6 MB.", { [field]: "This image is empty or too large." });
    try {
      const metadata = await sharp(input, { limitInputPixels: IMAGE_PIXELS, failOn: "warning" }).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format) ||
        (metadata.pages || 1) !== 1 || metadata.width < 200 || metadata.height < 200 ||
        metadata.width * metadata.height > IMAGE_PIXELS)
        throw new Error("Unsupported identity image");
      // Decode/re-encode strips EXIF/GPS, embedded profiles, original filenames
      // and appended data. No SVG, PDF, animation or original bytes are stored.
      return await sharp(input, { limitInputPixels: IMAGE_PIXELS, failOn: "warning" })
        .rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    } catch {
      throw new HttpError(422,
        "Upload a clear, unanimated JPEG, PNG or WebP image between 200 pixels wide/high and 20 megapixels.",
        { [field]: "This image could not be read safely. Choose a clear JPEG, PNG or WebP photograph." });
    }
  }
  async function submit(memberId, body, { assertAuthorized } = {}) {
    requireConfiguration();
    cleanup(memberId);
    if (!record(body) || body.identityConsent !== true)
      throw new HttpError(422,
        "Consent to the private ID document and selfie review before uploading.",
        { identityConsent: "Please read and accept the identity-image notice." });
    const application = getApplication(memberId);
    if (!application) throw new HttpError(404, "Member not found.");
    if (!application.identityRequired)
      throw new HttpError(409, "This member uses the original-ID staff review process.");
    if (application.status !== "pending" || !application.birthDate ||
      !application.submittedAt || validateBirthDate(application.birthDate, new Date(now())))
      throw new HttpError(409, "Submit a current adult eligibility application before uploading your ID and selfie.");
    const submissionBinding = binding(JSON.stringify([
      application.submittedAt, normalizedName(application.name), application.birthDate,
    ]));
    const count = db.prepare(
      "SELECT count(*) AS total FROM member_identity_uploads WHERE member_id=? AND uploaded_at>?",
    ).get(memberId, new Date(now() - 24 * 60 * 60 * 1000).toISOString()).total;
    if (count >= 5) throw new HttpError(429,
      "Too many identity-image submissions today. Please contact the store before trying again.");
    // Process sequentially to keep decompressed-image memory bounded.
    if (activeSubmissions >= 2)
      throw new HttpError(503, "Identity-image processing is busy. Please try again shortly.");
    let document, selfie;
    activeSubmissions += 1;
    try {
      document = await imageBytes(body.document, "document");
      selfie = await imageBytes(body.selfie, "selfie");
    } finally { activeSubmissions -= 1; }
    const id = randomUUID();
    const timestamp = new Date(now()).toISOString();
    transaction(() => {
      // Image decoding yields. The member session may have been revoked while
      // sharp was processing the files; re-check it before committing evidence.
      if (assertAuthorized) assertAuthorized();
      const current = getApplication(memberId);
      if (!current || current.status !== "pending" || !current.birthDate ||
        binding(JSON.stringify([current.submittedAt, normalizedName(current.name), current.birthDate])) !== submissionBinding)
        throw new HttpError(409, "Your application changed while the images were uploading. Submit your current details again.");
      const currentCount = db.prepare(
        "SELECT count(*) AS total FROM member_identity_uploads WHERE member_id=? AND uploaded_at>?",
      ).get(memberId, new Date(now() - 24 * 60 * 60 * 1000).toISOString()).total;
      if (currentCount >= 5) throw new HttpError(429, "Too many identity-image submissions today.");
      db.prepare("UPDATE member_identity_uploads SET status='superseded',document_blob=NULL,selfie_blob=NULL WHERE member_id=? AND status='pending'")
        .run(memberId);
      db.prepare(`INSERT INTO member_identity_uploads
        (id,member_id,submitted_at,name_binding,birth_binding,document_blob,selfie_blob,status,consent_at,uploaded_at,expires_at,key_id)
        VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?)`).run(
        id, memberId, current.submittedAt, binding(normalizedName(current.name)), binding(current.birthDate),
        encrypt(document, id, "document"), encrypt(selfie, id, "selfie"), timestamp, timestamp, now() + PENDING_MS, keyId,
      );
      onSubmitted({ memberId, uploadId: id });
    });
    return { verification: status(memberId) };
  }
  function image(memberId, kind, expectedUploadId) {
    requireConfiguration();
    cleanup(memberId);
    if (!["document", "selfie"].includes(kind)) throw new HttpError(404, "Identity image not found.");
    const upload = latest(memberId);
    if (upload?.status === "pending" && upload.key_id !== keyId)
      throw new HttpError(503, "The identity storage key has changed. The store must restore the original key before reviewing these images.");
    const bytes = upload?.[`${kind}_blob`];
    if (!upload || upload.status !== "pending" || !bytes ||
      (expectedUploadId && upload.id !== expectedUploadId) ||
      !sameApplication(upload, getApplication(memberId)))
      throw new HttpError(404, "This identity image is unavailable or its review has finished.");
    return { bytes: decrypt(bytes, upload.id, kind), contentType: "image/jpeg" };
  }
  function review(memberId, body, reviewerRef) {
    requireConfiguration();
    cleanup(memberId);
    if (!record(body) || body.method !== "uploaded_id_selfie" ||
      !["verified", "rejected"].includes(body.decision) || body.note)
      throw new HttpError(422, "Choose an ID-and-selfie review decision without personal notes.");
    if (body.decision === "verified" && (body.identityChecked !== true || body.ageChecked !== true))
      throw new HttpError(422, "Confirm that the ID photograph matches the selfie, the details match the application, and the ID shows an age of at least 18.");
    if (body.decision === "rejected" && !reasons.has(body.reason))
      throw new HttpError(422, "Choose a review reason without entering personal ID details.");
    transaction(() => {
      const upload = latest(memberId);
      const application = getApplication(memberId);
      if (!upload || upload.status !== "pending" || !upload.document_blob || !upload.selfie_blob ||
        application?.status !== "pending" || !application.birthDate ||
        !sameApplication(upload, application) ||
        body.expectedUploadId !== upload.id || body.expectedSubmittedAt !== upload.submitted_at)
        throw new HttpError(409, "This ID-and-selfie submission changed. Refresh the review queue before deciding.");
      if (body.decision === "verified" && validateBirthDate(application.birthDate, new Date(now())))
        throw new HttpError(422, "The current application does not establish an adult age.");
      const timestamp = new Date(now()).toISOString();
      recordDecision({
        memberId, submittedAt: upload.submitted_at, decision: body.decision,
        method: "uploaded_id_selfie", reason: body.decision === "rejected" ? body.reason : null,
        uploadId: upload.id, providerSessionId: upload.id,
        reviewerRef, decisionAt: timestamp,
      });
      db.prepare(`UPDATE member_identity_uploads SET status=?,reason=?,reviewed_at=?,reviewer_ref=?,
        document_blob=NULL,selfie_blob=NULL WHERE id=?`).run(
        body.decision, body.decision === "rejected" ? body.reason : null, timestamp,
        createHash("sha256").update(String(reviewerRef)).digest("hex"), upload.id,
      );
      onReviewed({ memberId, sourceRef: `identity-review:${upload.id}` });
    });
    return status(memberId);
  }
  cleanup();
  const timer = setInterval(cleanup, 60 * 60 * 1000);
  timer.unref();
  return {
    configStatus, status, submit, image, review, cleanup,
    dispose() { disposed = true; clearInterval(timer); },
  };
}
