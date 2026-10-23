// Server-side test fixtures only. Never import this helper into the storefront.
import assert from "node:assert/strict";
import { RESPONSIBILITY_QUESTIONS } from "../../server/onboarding.mjs";

export function cookieValue(response, name) {
  const values = response.headers.getSetCookie?.() || [
    response.headers.get("set-cookie") || "",
  ];
  const value = values.find(
    (item) => item.startsWith(`${name}=`) && !/Max-Age=0(?:;|$)/i.test(item),
  );
  return value?.split(";")[0] || "";
}

export function challengeAnswers(challenge) {
  return challenge.questions.map((question) => {
    const original = RESPONSIBILITY_QUESTIONS.find(
      (entry) => entry.id === question.id,
    );
    assert.ok(original, `Unknown local fixture question: ${question.id}`);
    return { questionId: question.id, choiceId: original.correctChoiceId };
  });
}

export async function prepareSignup(request, body, headers = {}) {
  const response = await request("/api/members/signup-challenge", { headers });
  assert.equal(response.status, 200, await response.clone().text());
  const challenge = await response.json();
  const challengeCookie = cookieValue(response, "lc_signup_challenge");
  assert.ok(
    challengeCookie,
    "A signup challenge must be bound to its browser cookie.",
  );
  return {
    body: {
      birthDate: "2000-01-01",
      verificationConsent: true,
      ...body,
      challengeId: challenge.challengeId,
      answers: challengeAnswers(challenge),
    },
    headers: {
      ...headers,
      Cookie: [headers.Cookie, challengeCookie].filter(Boolean).join("; "),
    },
  };
}

export async function verifiedMemberCookie(request, adminPassword) {
  const email = `order-fixture-${crypto.randomUUID()}@example.test`;
  const prepared = await prepareSignup(request, {
    name: "Adult Order Fixture",
    email,
    password: "Local adult order fixture password",
    ageConfirmed: true,
    termsAccepted: true,
  });
  const signup = await request("/api/members/signup", {
    method: "POST",
    ...prepared,
  });
  assert.equal(signup.status, 201, await signup.clone().text());
  const { member } = await signup.json();
  const memberCookie = cookieValue(signup, "lc_member");
  assert.ok(memberCookie);
  const login = await request("/api/admin/login", {
    method: "POST",
    body: { password: adminPassword },
  });
  assert.equal(login.status, 200, await login.clone().text());
  const staffCookie = cookieValue(login, "lc_staff");
  const reviewed = await request(
    `/api/admin/members/${member.id}/age-verification`,
    {
      method: "POST",
      headers: { Cookie: staffCookie },
      body: {
        decision: "verified",
        expectedSubmittedAt: member.ageVerification.submittedAt,
        method: "in_person",
        identityChecked: true,
        ageChecked: true,
      },
    },
  );
  assert.equal(reviewed.status, 200, await reviewed.clone().text());
  assert.equal(
    (await reviewed.json()).member.ageVerification.status,
    "verified",
  );
  return memberCookie;
}
