import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

export const MINIMUM_AGE = 18;
export const ONBOARDING_POLICY_VERSION = "2026-10-sa-private-review-v2";
const CHALLENGE_SECONDS = 15 * 60;
const PENDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "lc_signup_challenge";
const hash = (value) => createHash("sha256").update(value).digest("hex");

// Server-only knowledge questions. Answers are never returned by the public API.
// These questions teach responsible conduct; they do not establish identity or age.
export const RESPONSIBILITY_QUESTIONS = [
  {
    id: "private-use",
    prompt: "What does permission for an adult's private cannabis use mean?",
    choices: [
      {
        id: "private",
        label:
          "It concerns private use and does not automatically authorise commercial sales.",
      },
      {
        id: "any-sale",
        label: "It automatically allows anyone to sell cannabis.",
      },
      { id: "anywhere", label: "It permits cannabis use anywhere." },
    ],
    correctChoiceId: "private",
  },
  {
    id: "membership",
    prompt:
      "Does joining a cannabis membership website prove that a sale or delivery is lawful?",
    choices: [
      {
        id: "no",
        label:
          "No. Membership does not replace the business's required authorisation.",
      },
      { id: "yes", label: "Yes, every member may buy any cannabis product." },
      { id: "card", label: "Only if the membership card is digital." },
    ],
    correctChoiceId: "no",
  },
  {
    id: "photo-id",
    prompt: "What is needed before Loud +Cana's manual ID review can be completed?",
    choices: [
      {
        id: "original",
        label:
          "An authorised staff member actually compares the required ID evidence, photographs and application details.",
      },
      { id: "quiz", label: "Only passing these questions." },
      { id: "name", label: "Only entering a name and email address." },
    ],
    correctChoiceId: "original",
  },
  {
    id: "age-declaration",
    prompt: "What does entering a date of birth on a website establish?",
    choices: [
      {
        id: "declaration",
        label:
          "An age declaration that still needs identity evidence for verification.",
      },
      { id: "verified", label: "Automatic government-verified identity." },
      { id: "licence", label: "A licence to sell cannabis." },
    ],
    correctChoiceId: "declaration",
  },
  {
    id: "driving",
    prompt: "What should you do about driving after using cannabis?",
    choices: [
      {
        id: "avoid",
        label: "Do not drive while impaired; arrange a safe alternative.",
      },
      { id: "coffee", label: "Drink coffee and drive immediately." },
      { id: "short", label: "Drive only a short distance." },
    ],
    correctChoiceId: "avoid",
  },
  {
    id: "children",
    prompt: "Where should cannabis products be kept?",
    choices: [
      { id: "secure", label: "Securely, away from children and pets." },
      { id: "sweets", label: "Mixed with ordinary sweets." },
      { id: "open", label: "In an open place that anyone can reach." },
    ],
    correctChoiceId: "secure",
  },
  {
    id: "sharing",
    prompt: "Who should be protected from access to adult cannabis products?",
    choices: [
      {
        id: "minors",
        label: "Children and anyone who is not eligible to access them.",
      },
      { id: "none", label: "Nobody, if they are a member's friend." },
      { id: "guests", label: "Only people who do not have an email address." },
    ],
    correctChoiceId: "minors",
  },
  {
    id: "labelling",
    prompt: "What should you do before making an informed product choice?",
    choices: [
      {
        id: "read",
        label:
          "Read the actual label and confirm product information with the authorised business.",
      },
      { id: "assume", label: "Assume every product has the same contents." },
      { id: "picture", label: "Rely only on the product picture." },
    ],
    correctChoiceId: "read",
  },
  {
    id: "medical",
    prompt:
      "Can a membership website replace advice from a qualified health professional?",
    choices: [
      {
        id: "no",
        label:
          "No. Seek appropriate professional advice for health or medicine questions.",
      },
      { id: "yes", label: "Yes, a membership account is a prescription." },
      { id: "popular", label: "Yes, if a product is popular." },
    ],
    correctChoiceId: "no",
  },
  {
    id: "privacy",
    prompt: "What should you submit through this signup form for an age check?",
    choices: [
      {
        id: "minimal",
        label:
          "Only the requested details here; submit ID photographs and selfies only through the private review form.",
      },
      { id: "id-number", label: "A full identity number in an answer box." },
      { id: "password", label: "Your email account's password." },
    ],
    correctChoiceId: "minimal",
  },
  {
    id: "account",
    prompt: "How should you protect your membership account?",
    choices: [
      {
        id: "unique",
        label: "Use a unique password and keep sign-in details private.",
      },
      { id: "share", label: "Share the password with anyone who asks." },
      { id: "public", label: "Post the password in a public message." },
    ],
    correctChoiceId: "unique",
  },
  {
    id: "uncertain",
    prompt:
      "What should you do if a product's legality or information is unclear?",
    choices: [
      {
        id: "confirm",
        label:
          "Pause and ask the authorised business for clear, accurate information.",
      },
      { id: "ignore", label: "Ignore the uncertainty." },
      { id: "assume", label: "Assume website membership makes it legal." },
    ],
    correctChoiceId: "confirm",
  },
  {
    id: "consent",
    prompt: "What does accepting the signup privacy notice cover?",
    choices: [
      {
        id: "stated",
        label:
          "The stated account and age-check processing, not automatic marketing consent.",
      },
      { id: "marketing", label: "Unlimited marketing from anyone." },
      { id: "public", label: "Publishing identity documents publicly." },
    ],
    correctChoiceId: "stated",
  },
  {
    id: "responsibility",
    prompt: "What is the purpose of these random questions?",
    choices: [
      {
        id: "awareness",
        label:
          "To check awareness of responsible conduct; they are not proof of age.",
      },
      { id: "identity", label: "To replace a real identity check." },
      {
        id: "sales",
        label: "To grant commercial cannabis-sales authorisation.",
      },
    ],
    correctChoiceId: "awareness",
  },
  {
    id: "delivery",
    prompt: "What does an online order request mean?",
    choices: [
      {
        id: "review",
        label:
          "The business must still review eligibility, availability and lawful fulfilment.",
      },
      { id: "automatic", label: "Automatic permission for any delivery." },
      { id: "proof", label: "Proof that the customer has shown original ID." },
    ],
    correctChoiceId: "review",
  },
];
const questionById = new Map(RESPONSIBILITY_QUESTIONS.map((q) => [q.id, q]));
const reasons = new Set([
  "identity_not_confirmed",
  "details_mismatch",
  "unable_to_verify",
]);

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function southAfricanDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function validateBirthDate(value, now = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return "Enter your date of birth as a valid calendar date.";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return "Enter a valid date of birth.";
  const today = southAfricanDate(now);
  if (value > today) return "Your date of birth cannot be in the future.";
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  const age =
    currentYear -
    year -
    (currentMonth < month || (currentMonth === month && currentDay < day)
      ? 1
      : 0);
  if (age < MINIMUM_AGE)
    return "You must be 18 or older to create an adult membership account.";
  return "";
}

function appendCookie(res, value) {
  const existing = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    value,
  ]);
}

export function createOnboarding({ db, production, HttpError, onReviewed = () => {} }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_signup_challenges (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, question_ids TEXT NOT NULL,
      expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS signup_challenge_expiry ON member_signup_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS member_age_checks (
      member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('required','pending','verified','rejected')),
      birth_date TEXT, submitted_at TEXT, verified_at TEXT, method TEXT, reason TEXT,
      consent_at TEXT, questions_passed_at TEXT, question_ids TEXT, policy_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_age_audit (
      id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      decision TEXT NOT NULL, method TEXT NOT NULL, reviewed_at TEXT NOT NULL,
      reviewer_ref TEXT NOT NULL, reason TEXT
    );
  `);
  if (!db.prepare("PRAGMA table_info(member_age_checks)").all().some((column) => column.name === "identity_required"))
    db.exec("ALTER TABLE member_age_checks ADD COLUMN identity_required INTEGER NOT NULL DEFAULT 0");
  if (!db.prepare("PRAGMA table_info(member_age_checks)").all().some((column) => column.name === "identity_consent_at"))
    db.exec("ALTER TABLE member_age_checks ADD COLUMN identity_consent_at TEXT");
  const challengeById = db.prepare(
    "SELECT * FROM member_signup_challenges WHERE id = ?",
  );
  const ageById = db.prepare(
    "SELECT * FROM member_age_checks WHERE member_id = ?",
  );
  const tokenFrom = (req) =>
    String(req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) || "";
  const challengeCookie = (token, age = CHALLENGE_SECONDS) =>
    `${COOKIE_NAME}=${token}; Path=/api/members; HttpOnly; SameSite=Strict; Max-Age=${age}${production ? "; Secure" : ""}`;
  function cleanup() {
    db.prepare(
      "DELETE FROM member_signup_challenges WHERE expires_at <= ?",
    ).run(Date.now());
    db.prepare(
      "UPDATE member_age_checks SET status='required', birth_date=NULL, reason='expired', method=NULL WHERE status='pending' AND submitted_at < ?",
    ).run(new Date(Date.now() - PENDING_RETENTION_MS).toISOString());
  }
  function publicAge(memberId) {
    cleanup();
    const age = ageById.get(memberId);
    return {
      status: age?.status || "required",
      minimumAge: MINIMUM_AGE,
      method: age?.method || null,
      submittedAt: age?.submitted_at || null,
      verifiedAt: age?.verified_at || null,
      reason: age?.reason || null,
    };
  }
  function createChallenge(req, res) {
    cleanup();
    const priorToken = tokenFrom(req);
    if (priorToken)
      db.prepare(
        "DELETE FROM member_signup_challenges WHERE token_hash = ? AND consumed_at IS NULL",
      ).run(hash(priorToken));
    const prior = db
      .prepare(
        "SELECT value FROM metadata WHERE key = 'last_onboarding_questions'",
      )
      .get()?.value;
    let selected = shuffle(RESPONSIBILITY_QUESTIONS).slice(0, 3);
    if (
      selected
        .map((q) => q.id)
        .sort()
        .join(",") === prior
    ) {
      const remaining = RESPONSIBILITY_QUESTIONS.filter(
        (q) => !selected.includes(q),
      );
      selected[2] = remaining[randomInt(remaining.length)];
    }
    db.prepare(
      "INSERT INTO metadata (key,value) VALUES ('last_onboarding_questions',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(
      selected
        .map((q) => q.id)
        .sort()
        .join(","),
    );
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const expiry = Date.now() + CHALLENGE_SECONDS * 1000;
    db.prepare(
      "INSERT INTO member_signup_challenges (id,token_hash,question_ids,expires_at) VALUES (?,?,?,?)",
    ).run(id, hash(token), JSON.stringify(selected.map((q) => q.id)), expiry);
    appendCookie(res, challengeCookie(token));
    return {
      challengeId: id,
      expiresAt: new Date(expiry).toISOString(),
      minimumAge: MINIMUM_AGE,
      policyVersion: ONBOARDING_POLICY_VERSION,
      questions: selected.map(({ id, prompt, choices }) => ({
        id,
        prompt,
        choices: shuffle(choices),
      })),
    };
  }
  function validateSubmission(req, body) {
    const errors = {};
    const birthError = validateBirthDate(body.birthDate);
    if (birthError) errors.birthDate = birthError;
    if (body.ageConfirmed !== true)
      errors.ageConfirmed = "Confirm that you are 18 or older.";
    if (body.verificationConsent !== true)
      errors.verificationConsent =
        "Consent to the stated age-check processing.";
    if (Object.keys(errors).length)
      throw new HttpError(
        422,
        "Please check your date of birth and age-check consent.",
        errors,
      );
    const challenge = challengeById.get(
      typeof body.challengeId === "string" ? body.challengeId : "",
    );
    const cookieToken = tokenFrom(req);
    if (
      !challenge ||
      !cookieToken ||
      hash(cookieToken) !== challenge.token_hash ||
      challenge.expires_at <= Date.now() ||
      challenge.consumed_at ||
      challenge.attempts >= 3
    )
      throw new HttpError(
        422,
        "Your questions expired, were replaced, or were already used. Request new questions and try again.",
        { challengeId: "Request new questions and try again." },
      );
    const expected = JSON.parse(challenge.question_ids);
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const valid =
      answers.length === expected.length &&
      new Set(answers.map((answer) => answer?.questionId)).size ===
        expected.length &&
      expected.every((id) =>
        answers.some(
          (answer) =>
            answer &&
            answer.questionId === id &&
            answer.choiceId === questionById.get(id)?.correctChoiceId,
        ),
      );
    if (!valid) {
      db.prepare(
        "UPDATE member_signup_challenges SET attempts = attempts + 1 WHERE id = ?",
      ).run(challenge.id);
      throw new HttpError(
        422,
        challenge.attempts + 1 >= 3
          ? "Please request new questions before trying again."
          : "One or more safety answers need another look. Review the guidance and try again.",
        { answers: "Answer each question correctly to continue." },
      );
    }
    return {
      challengeId: challenge.id,
      birthDate: body.birthDate,
      questionIds: expected,
    };
  }
  function recordSubmission(memberId, submission, res, identityRequired = false) {
    const previousTime =
      Date.parse(ageById.get(memberId)?.submitted_at || "") || 0;
    // A review version must change even when two valid submissions arrive in one millisecond.
    const now = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
    const consumed = db
      .prepare(
        "UPDATE member_signup_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<3",
      )
      .run(now, submission.challengeId, Date.now());
    if (consumed.changes !== 1)
      throw new HttpError(
        409,
        "These questions were already used. Request new questions and try again.",
      );
    db.prepare(
      `INSERT INTO member_age_checks (member_id,status,birth_date,submitted_at,verified_at,method,reason,consent_at,questions_passed_at,question_ids,policy_version)
      VALUES (?,'pending',?,?,NULL,NULL,NULL,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET status='pending',birth_date=excluded.birth_date,submitted_at=excluded.submitted_at,verified_at=NULL,method=NULL,reason=NULL,consent_at=excluded.consent_at,questions_passed_at=excluded.questions_passed_at,question_ids=excluded.question_ids,policy_version=excluded.policy_version`,
    ).run(
      memberId,
      submission.birthDate,
      now,
      now,
      now,
      JSON.stringify(submission.questionIds),
      ONBOARDING_POLICY_VERSION,
    );
    if (identityRequired)
      db.prepare("UPDATE member_age_checks SET identity_required=1,identity_consent_at=? WHERE member_id=?").run(now, memberId);
    appendCookie(res, challengeCookie("", 0));
  }
  function invalidateName(memberId) {
    const previous = Date.parse(ageById.get(memberId)?.submitted_at || "") || 0;
    const version = new Date(Math.max(Date.now(), previous + 1)).toISOString();
    db.prepare(
      "UPDATE member_age_checks SET status='required',birth_date=NULL,submitted_at=?,verified_at=NULL,method=NULL,reason='name_changed' WHERE member_id=?",
    ).run(version, memberId);
  }
  function requireVerified(memberId) {
    const age = publicAge(memberId);
    if (age.status !== "verified" || (ageById.get(memberId)?.identity_required && age.method !== "uploaded_id_selfie"))
      throw new HttpError(
        403,
        "Complete the required staff ID and age review before submitting an order request.",
      );
  }
  function queue(status, memberId = "") {
    cleanup();
    const filter = ["required", "pending", "verified", "rejected"].includes(
      status,
    )
      ? status
      : "pending";
    return db
      .prepare(
        `SELECT m.id,m.name,m.email,a.birth_date FROM members m LEFT JOIN member_age_checks a ON a.member_id=m.id WHERE ${memberId ? "m.id=?" : "COALESCE(a.status,'required')=?"} ORDER BY COALESCE(a.submitted_at,m.created_at) DESC LIMIT 500`,
      )
      .all(memberId || filter)
      .map((row) => {
        const verification = publicAge(row.id);
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          birthDate: verification.status === "pending" ? row.birth_date : null,
          ageVerification: verification,
        };
      });
  }
  function review(memberId, body, reviewerRef) {
    const member = db
      .prepare("SELECT id FROM members WHERE id=?")
      .get(memberId);
    if (!member) throw new HttpError(404, "Member not found.");
    const current = publicAge(memberId);
    const age = ageById.get(memberId);
    if (age?.identity_required)
      throw new HttpError(409, "This application requires the private uploaded ID and selfie review.");
    if (current.status !== "pending" || !age?.birth_date)
      throw new HttpError(
        409,
        "This member must submit a current age-check application before review.",
      );
    if (body.expectedSubmittedAt !== age.submitted_at)
      throw new HttpError(
        409,
        "This application changed. Refresh the age-check queue before making a decision.",
      );
    if (
      body.method !== "in_person" ||
      !["verified", "rejected"].includes(body.decision)
    )
      throw new HttpError(
        422,
        "Choose the in-person review method and a valid decision.",
      );
    if (body.note)
      throw new HttpError(
        422,
        "Use a review reason only. Do not submit ID numbers, ID images, or personal notes.",
      );
    if (
      body.decision === "verified" &&
      (body.identityChecked !== true ||
        body.ageChecked !== true ||
        validateBirthDate(age.birth_date))
    )
      throw new HttpError(
        422,
        "Confirm that original valid photo ID matches the person, name and date of birth, and that the person is at least 18.",
      );
    if (body.decision === "rejected" && !reasons.has(body.reason))
      throw new HttpError(
        422,
        "Choose a review reason without entering personal ID details.",
      );
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          "UPDATE member_age_checks SET status=?,birth_date=NULL,verified_at=?,method=?,reason=? WHERE member_id=? AND status='pending' AND submitted_at=?",
        )
        .run(
          body.decision,
          body.decision === "verified" ? now : null,
          "in_person",
          body.decision === "rejected" ? body.reason : null,
          memberId,
          body.expectedSubmittedAt,
        );
      if (result.changes !== 1)
        throw new HttpError(
          409,
          "This application changed. Refresh the age-check queue.",
        );
      db.prepare(
        "INSERT INTO member_age_audit (id,member_id,decision,method,reviewed_at,reviewer_ref,reason) VALUES (?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        memberId,
        body.decision,
        "in_person",
        now,
        hash(reviewerRef),
        body.decision === "rejected" ? body.reason : null,
      );
      onReviewed({ memberId, sourceRef: `in-person-review:${memberId}:${body.expectedSubmittedAt}` });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return publicAge(memberId);
  }
  cleanup();
  const cleanupTimer = setInterval(cleanup, 60 * 60 * 1000);
  cleanupTimer.unref();
  return {
    createChallenge,
    validateSubmission,
    recordSubmission,
    publicAge,
    invalidateName,
    requireVerified,
    queue,
    review,
    providerApplication(memberId) {
      cleanup();
      const row = ageById.get(memberId);
      return row ? {
        memberId, birthDate: row.birth_date, submittedAt: row.submitted_at,
        status: row.status, method: row.method, identityRequired: Boolean(row.identity_required),
      } : null;
    },
    recordIdentityDecision({ memberId, submittedAt, decision, reason, uploadId, reviewerRef }) {
      if (!["verified", "rejected"].includes(decision))
        throw new HttpError(422, "Unsupported identity decision.");
      const current = ageById.get(memberId);
      if (!current || !current.identity_required || current.submitted_at !== submittedAt ||
          !["pending", "verified", "rejected"].includes(current.status) ||
          (decision === "verified" && current.status === "pending" && validateBirthDate(current.birth_date)))
        throw new HttpError(409, "The identity application changed or expired.");
      if (current.status === decision && current.method === "uploaded_id_selfie") return publicAge(memberId);
      const timestamp = new Date().toISOString();
      const safeReason = decision === "rejected" ? (reasons.has(reason) ? reason : "unable_to_verify") : null;
      const ownsTransaction = !db.isTransaction;
      if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
      try {
        const result = db.prepare("UPDATE member_age_checks SET status=?,birth_date=NULL,verified_at=?,method='uploaded_id_selfie',reason=? WHERE member_id=? AND submitted_at=? AND identity_required=1")
          .run(decision, decision === "verified" ? timestamp : null, safeReason, memberId, submittedAt);
        if (result.changes !== 1) throw new HttpError(409, "The identity application changed.");
        db.prepare("INSERT INTO member_age_audit (id,member_id,decision,method,reviewed_at,reviewer_ref,reason) VALUES (?,?,?,'uploaded_id_selfie',?,?,?)")
          .run(randomUUID(), memberId, decision, timestamp, hash(String(reviewerRef || uploadId)), safeReason);
        if (ownsTransaction) db.exec("COMMIT");
      } catch (error) { if (ownsTransaction) db.exec("ROLLBACK"); throw error; }
      return publicAge(memberId);
    },
    close: () => clearInterval(cleanupTimer),
  };
}
