import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "../server/app.mjs";
import {
  RESPONSIBILITY_QUESTIONS,
  validateBirthDate,
  southAfricanDate,
} from "../server/onboarding.mjs";

const password = "Local-only age verification password 42";
const staffPassword = "Local-only staff verification password 84";
const validDetails = {
  name: "Jordan Adult",
  email: "jordan-age@example.test",
  password,
  birthDate: "2000-01-01",
  ageConfirmed: true,
  termsAccepted: true,
  verificationConsent: true,
};
const liveConfig = {
  businessName: "Local age fixture",
  businessJurisdiction: "Local test only",
  storeLicenseNumber: "LOCAL-TEST-NOT-A-LICENCE",
  deliveryZips: ["2196"],
  pickupAddress: "Local test fixture only",
  contactEmail: "local@example.test",
  liveOrdersEnabled: true,
  legalSalesAuthorizationConfirmed: true,
  catalogApproved: true,
};

async function start(t, options = {}) {
  const server = createServer({ adminPassword: staffPassword, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  };
  t.after(close);
  const client = () => {
    const cookies = new Map();
    return {
      cookies,
      async request(
        path,
        {
          body,
          method = body === undefined ? "GET" : "POST",
          cookie,
          ...options
        } = {},
      ) {
        const response = await fetch(base + path, {
          method,
          ...options,
          headers: {
            ...(body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
            Cookie:
              cookie ??
              [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
            ...options.headers,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        for (const value of response.headers.getSetCookie()) {
          const pair = value.split(";")[0];
          const key = pair.slice(0, pair.indexOf("="));
          const token = pair.slice(pair.indexOf("=") + 1);
          if (token) cookies.set(key, token);
          else if (!value.includes("Path=/api/members") || key !== "lc_member")
            cookies.delete(key);
        }
        return response;
      },
    };
  };
  return { base, client, close };
}
async function challenge(client) {
  const response = await client.request("/api/members/signup-challenge");
  assert.equal(response.status, 200);
  const data = await response.json();
  return {
    ...data,
    answers: data.questions.map((question) => ({
      questionId: question.id,
      choiceId: RESPONSIBILITY_QUESTIONS.find((q) => q.id === question.id)
        .correctChoiceId,
    })),
  };
}
async function signup(client, overrides = {}) {
  const questions = await challenge(client);
  const response = await client.request("/api/members/signup", {
    body: {
      ...validDetails,
      challengeId: questions.challengeId,
      answers: questions.answers,
      ...overrides,
    },
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).member;
}
async function staff(client) {
  const response = await client.request("/api/admin/login", {
    body: { password: staffPassword },
  });
  assert.equal(response.status, 200);
}
async function verify(client, id, body = {}) {
  const queue = await (
    await client.request("/api/admin/members/age-verifications?status=pending")
  ).json();
  const expectedSubmittedAt = queue.members?.find((member) => member.id === id)
    ?.ageVerification.submittedAt;
  return client.request(`/api/admin/members/${id}/age-verification`, {
    body: {
      decision: "verified",
      method: "in_person",
      identityChecked: true,
      ageChecked: true,
      expectedSubmittedAt,
      ...body,
    },
  });
}

test("age eligibility uses valid calendar dates and the South African birthday boundary", () => {
  assert.equal(
    southAfricanDate(new Date("2026-10-22T22:00:00Z")),
    "2026-10-23",
  );
  assert.match(
    validateBirthDate("2008-10-23", new Date("2026-10-22T21:59:59Z")),
    /18/,
  );
  assert.equal(
    validateBirthDate("2008-10-23", new Date("2026-10-22T22:00:00Z")),
    "",
  );
  assert.match(
    validateBirthDate("2027-01-01", new Date("2026-10-22Z")),
    /future/,
  );
  for (const value of [
    "2000-02-30",
    "2001-02-29",
    "2000-13-01",
    "2000-00-10",
    "2000-1-1",
    null,
    20000101,
  ])
    assert.ok(validateBirthDate(value));
  assert.match(
    validateBirthDate("2008-02-29", new Date("2026-02-28T10:00:00Z")),
    /18/,
  );
  assert.equal(
    validateBirthDate("2008-02-29", new Date("2026-03-01T10:00:00Z")),
    "",
  );
});

test("random questions are fresh, shuffled, cookie-bound and never disclose an answer key", async (t) => {
  const { client } = await start(t);
  const first = client(),
    second = client();
  const one = await challenge(first),
    two = await challenge(second);
  assert.notEqual(one.challengeId, two.challengeId);
  assert.equal(one.minimumAge, 18);
  assert.equal(one.questions.length, 3);
  assert.notEqual(
    one.questions
      .map((q) => q.id)
      .sort()
      .join(","),
    two.questions
      .map((q) => q.id)
      .sort()
      .join(","),
  );
  for (const question of one.questions) {
    assert.deepEqual(Object.keys(question).sort(), ["choices", "id", "prompt"]);
    assert.equal(question.choices.length, 3);
    assert.ok(
      question.choices.every(
        (choice) => Object.keys(choice).sort().join(",") === "id,label",
      ),
    );
  }
  assert.equal(typeof one.expiresAt, "string");
  const stolen = await second.request("/api/members/signup", {
    body: {
      ...validDetails,
      challengeId: one.challengeId,
      answers: one.answers,
    },
  });
  assert.equal(stolen.status, 422);
  assert.match((await stolen.json()).error, /Request new questions/);
});

test("under-age declarations, missing consent and incorrect knowledge answers cannot create members", async (t) => {
  const { client } = await start(t);
  const applicant = client();
  const q = await challenge(applicant);
  const body = {
    ...validDetails,
    challengeId: q.challengeId,
    answers: q.answers,
  };
  for (const change of [
    { birthDate: "2020-01-01" },
    { birthDate: "2099-01-01" },
    { verificationConsent: false },
    { ageConfirmed: false },
  ]) {
    const response = await applicant.request("/api/members/signup", {
      body: { ...body, ...change },
    });
    assert.equal(response.status, 422);
  }
  for (let attempt = 0; attempt < 3; attempt++)
    assert.equal(
      (
        await applicant.request("/api/members/signup", {
          body: {
            ...body,
            answers: q.answers.map((a) => ({ ...a, choiceId: "incorrect" })),
          },
        })
      ).status,
      422,
    );
  const after = await applicant.request("/api/members/signup", { body });
  assert.equal(after.status, 422);
  assert.match((await after.json()).error, /Request new questions/);
  assert.deepEqual(await (await applicant.request("/api/members/me")).json(), {
    member: null,
  });
});

test("signup is pending rather than identity-verified and a challenge cannot be replayed", async (t) => {
  const { client } = await start(t);
  const applicant = client();
  const q = await challenge(applicant);
  const originalCookie = applicant.cookies.get("lc_signup_challenge");
  const body = {
    ...validDetails,
    challengeId: q.challengeId,
    answers: q.answers,
  };
  const response = await applicant.request("/api/members/signup", { body });
  assert.equal(response.status, 201);
  const { member } = await response.json();
  assert.equal(member.ageVerification.status, "pending");
  assert.equal(member.ageVerification.verifiedAt, null);
  assert.equal(member.ageVerification.minimumAge, 18);
  assert.equal(member.birthDate, undefined);
  assert.ok(
    response.headers
      .getSetCookie()
      .some(
        (value) =>
          value.startsWith("lc_member=") &&
          value.includes("Path=/api;") &&
          !value.includes("Max-Age=0"),
      ),
  );
  applicant.cookies.set("lc_signup_challenge", originalCookie);
  const replay = await applicant.request("/api/members/signup", {
    body: { ...body, email: "different@example.test" },
  });
  assert.equal(replay.status, 422);
});

test("staff must actually attest the original ID check; verified age clears DOB and enforces member-only orders", async (t) => {
  const { client } = await start(t, { config: liveConfig });
  const applicant = client(),
    reviewer = client(),
    anonymous = client();
  const member = await signup(applicant);
  const order = {
    fulfillment: "delivery",
    ageConfirmed: true,
    customer: {
      name: "Jordan Adult",
      email: "jordan-age@example.test",
      phone: "0712345678",
      address: "Local test address",
      city: "Johannesburg",
      postcode: "2196",
    },
    items: [{ productId: "sunset-sherbet", sizeIndex: 0, quantity: 1 }],
  };
  assert.equal(
    (await anonymous.request("/api/orders", { body: order })).status,
    401,
  );
  assert.equal(
    (await applicant.request("/api/orders", { body: order })).status,
    403,
  );
  assert.equal(
    (await applicant.request("/api/admin/members/age-verifications")).status,
    401,
  );
  assert.equal((await verify(applicant, member.id)).status, 401);
  await staff(reviewer);
  const pending = await (
    await reviewer.request(
      "/api/admin/members/age-verifications?status=pending",
    )
  ).json();
  assert.equal(pending.members[0].birthDate, "2000-01-01");
  assert.equal(
    (await verify(reviewer, member.id, { identityChecked: false })).status,
    422,
  );
  assert.equal(
    (await verify(reviewer, member.id, { ageChecked: false })).status,
    422,
  );
  assert.equal(
    (await verify(reviewer, member.id, { method: "self_declaration" })).status,
    422,
  );
  const checked = await verify(reviewer, member.id);
  assert.equal(checked.status, 200);
  assert.equal(
    (await checked.json()).member.ageVerification.status,
    "verified",
  );
  const reviewed = await (
    await reviewer.request(
      "/api/admin/members/age-verifications?status=verified",
    )
  ).json();
  assert.equal(reviewed.members[0].birthDate, null);
  const submitted = await applicant.request("/api/orders", { body: order });
  assert.equal(submitted.status, 201, await submitted.clone().text());
  const renamed = await applicant.request("/api/members/me", {
    method: "PATCH",
    body: { name: "A different legal name" },
  });
  assert.equal(
    (await renamed.json()).member.ageVerification.status,
    "required",
  );
  assert.equal(
    (await applicant.request("/api/orders", { body: order })).status,
    403,
  );
});

test("rejected checks remove DOB, use privacy-safe reasons and can be resubmitted with new questions", async (t) => {
  const { client } = await start(t);
  const applicant = client(),
    reviewer = client();
  const member = await signup(applicant);
  await staff(reviewer);
  assert.equal(
    (
      await verify(reviewer, member.id, {
        note: "Do not retain an identity number",
      })
    ).status,
    422,
  );
  const rejected = await reviewer.request(
    `/api/admin/members/${member.id}/age-verification`,
    {
      body: {
        decision: "rejected",
        method: "in_person",
        reason: "details_mismatch",
        expectedSubmittedAt: member.ageVerification.submittedAt,
      },
    },
  );
  assert.equal(rejected.status, 200);
  assert.equal(
    (await rejected.json()).member.ageVerification.status,
    "rejected",
  );
  const rows = await (
    await reviewer.request(
      "/api/admin/members/age-verifications?status=rejected",
    )
  ).json();
  assert.equal(rows.members[0].birthDate, null);
  const q = await challenge(applicant);
  const again = await applicant.request("/api/members/age-verification", {
    body: {
      birthDate: "2000-01-01",
      ageConfirmed: true,
      verificationConsent: true,
      challengeId: q.challengeId,
      answers: q.answers,
    },
  });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).member.ageVerification.status, "pending");
});

test("expiry, DOB retention, audit minimisation and old narrow-cookie migration survive storage restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cana-age-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dbPath = join(directory, "members.sqlite");
  const one = await start(t, { dbPath });
  const applicant = one.client(),
    reviewer = one.client();
  let member = await signup(applicant);
  await staff(reviewer);
  const token = applicant.cookies.get("lc_member");
  const migration = await applicant.request("/api/members/me", {
    cookie: `lc_member=${token}`,
  });
  assert.equal(migration.status, 200);
  assert.ok(
    migration.headers
      .getSetCookie()
      .some((v) => v.includes("Path=/api;") && !v.includes("Max-Age=0")),
  );
  assert.ok(
    migration.headers
      .getSetCookie()
      .some((v) => v.includes("Path=/api/members;") && v.includes("Max-Age=0")),
  );
  await verify(reviewer, member.id);
  const db = new DatabaseSync(dbPath);
  assert.equal(
    db
      .prepare("SELECT birth_date FROM member_age_checks WHERE member_id=?")
      .get(member.id).birth_date,
    null,
  );
  const audit = db
    .prepare("SELECT * FROM member_age_audit WHERE member_id=?")
    .get(member.id);
  assert.equal(audit.decision, "verified");
  assert.ok(!JSON.stringify(audit).includes("2000-01-01"));
  assert.equal(audit.note, undefined);
  const fresh = one.client();
  const questions = await challenge(fresh);
  db.prepare("UPDATE member_signup_challenges SET expires_at=? WHERE id=?").run(
    Date.now() - 1000,
    questions.challengeId,
  );
  const expired = await fresh.request("/api/members/signup", {
    body: {
      ...validDetails,
      email: "expired@example.test",
      challengeId: questions.challengeId,
      answers: questions.answers,
    },
  });
  assert.equal(expired.status, 422);
  db.prepare(
    "UPDATE member_age_checks SET status='pending',birth_date='2000-01-01',submitted_at=? WHERE member_id=?",
  ).run("2000-01-01T00:00:00.000Z", member.id);
  db.close();
  await one.close();
  const two = await start(t, { dbPath });
  const resumed = two.client();
  const response = await resumed.request("/api/members/me", {
    cookie: `lc_member=${token}`,
  });
  assert.equal(response.status, 200);
  member = (await response.json()).member;
  assert.equal(member.ageVerification.status, "required");
  const persisted = new DatabaseSync(dbPath);
  assert.equal(
    persisted
      .prepare("SELECT birth_date FROM member_age_checks WHERE member_id=?")
      .get(member.id).birth_date,
    null,
  );
  persisted.close();
});

test("a stale staff decision cannot verify a replacement application even within the same clock millisecond", async (t) => {
  const originalNow = Date.now;
  const frozen = Date.now();
  Date.now = () => frozen;
  try {
    const { client } = await start(t);
    const applicant = client(),
      reviewer = client();
    const member = await signup(applicant);
    await staff(reviewer);
    const oldSubmitted = member.ageVerification.submittedAt;
    await applicant.request("/api/members/me", {
      method: "PATCH",
      body: { name: "Jordan Corrected Name" },
    });
    const q = await challenge(applicant);
    const fresh = await applicant.request("/api/members/age-verification", {
      body: {
        birthDate: "2000-01-01",
        ageConfirmed: true,
        verificationConsent: true,
        challengeId: q.challengeId,
        answers: q.answers,
      },
    });
    assert.equal(fresh.status, 200);
    const updated = (await fresh.json()).member;
    assert.notEqual(updated.ageVerification.submittedAt, oldSubmitted);
    const stale = await verify(reviewer, member.id, {
      expectedSubmittedAt: oldSubmitted,
    });
    assert.equal(stale.status, 409);
    assert.equal(
      (await (await applicant.request("/api/members/me")).json()).member
        .ageVerification.status,
      "pending",
    );
    assert.equal(
      (
        await verify(reviewer, member.id, {
          expectedSubmittedAt: updated.ageVerification.submittedAt,
        })
      ).status,
      200,
    );
  } finally {
    Date.now = originalNow;
  }
});

test("revoking age eligibility while an order body is arriving cannot create an order", async (t) => {
  const { client, base } = await start(t, { config: liveConfig });
  const applicant = client(),
    reviewer = client();
  const member = await signup(applicant);
  await staff(reviewer);
  assert.equal((await verify(reviewer, member.id)).status, 200);
  const order = JSON.stringify({
    fulfillment: "delivery",
    ageConfirmed: true,
    customer: {
      name: "Jordan Adult",
      email: validDetails.email,
      phone: "0712345678",
      address: "Local test fixture",
      city: "Johannesburg",
      postcode: "2196",
    },
    items: [{ productId: "sunset-sherbet", quantity: 1 }],
  });
  let releaseBody;
  const paused = new Promise((resolve) => {
    releaseBody = resolve;
  });
  const responsePromise = fetch(base + "/api/orders", {
    method: "POST",
    duplex: "half",
    headers: {
      "Content-Type": "application/json",
      Cookie: [...applicant.cookies]
        .map(([key, value]) => `${key}=${value}`)
        .join("; "),
    },
    body: (async function* () {
      yield order.slice(0, 10);
      await paused;
      yield order.slice(10);
    })(),
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await applicant.request("/api/members/me", {
    method: "PATCH",
    body: { name: "Changed while body was uploading" },
  });
  releaseBody();
  const response = await responsePromise;
  assert.equal(response.status, 403);
  const orders = await (await reviewer.request("/api/admin/orders")).json();
  assert.equal(orders.orders.length, 0);
});
