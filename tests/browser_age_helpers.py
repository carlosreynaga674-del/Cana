"""Local-only age onboarding fixtures; never served to the storefront."""
import json
from pathlib import Path
import subprocess
import sqlite3
import base64
from functools import lru_cache
from uuid import uuid4
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[1]
ADULT_BIRTH_DATE = "2000-01-01"


@lru_cache(maxsize=1)
def synthetic_identity_images():
    """Generate obvious synthetic image fixtures locally; never real ID images."""
    result = subprocess.run(["node", "--input-type=module", "-e", """
import {identityFixture} from './tests/helpers/identity-fixture.mjs';
const fixture=await identityFixture();
console.log(JSON.stringify(fixture.body));
"""], cwd=ROOT, capture_output=True, text=True, check=True)
    body = json.loads(result.stdout)
    return {key: base64.b64decode(body[key]["data"]) for key in ("document", "selfie")}


def fill_identity_images(page):
    for key, content in synthetic_identity_images().items():
        page.locator(f'input[name="{key}"]').set_input_files({
            "name": f"local-synthetic-{key}.png", "mimeType": "image/png", "buffer": content,
        })


def mark_legacy_member(database, member_id):
    """Model a member enrolled before mandatory uploads in an isolated local database."""
    assert Path(database).is_file()
    with sqlite3.connect(database) as fixture:
        fixture.execute("UPDATE member_age_checks SET identity_required=0 WHERE member_id=?", (member_id,))


def answer_bank():
    result = subprocess.run(
        ["node", "--input-type=module", "-e", "import {RESPONSIBILITY_QUESTIONS} from './server/onboarding.mjs'; console.log(JSON.stringify(Object.fromEntries(RESPONSIBILITY_QUESTIONS.map(q=>[q.id,q.correctChoiceId]))));"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def challenge_answers(challenge):
    bank = answer_bank()
    return [{"questionId": question["id"], "choiceId": bank[question["id"]]} for question in challenge["questions"]]


def fill_questions(page, correct=True):
    questions = page.locator("fieldset.age-question")
    expect(questions).to_have_count(3)
    bank = answer_bank()
    for question in questions.all():
        radios = question.locator('input[type="radio"]')
        question_id = radios.first.get_attribute("name").removeprefix("answer-")
        expected = bank[question_id]
        for radio in radios.all():
            if (radio.get_attribute("value") == expected) == correct:
                radio.check()
                break
        else:
            raise AssertionError(f"No fixture answer for {question_id}")


def register_member(context, base, password, name="Local Adult Fixture", email=None):
    email = email or f"adult-browser-{uuid4().hex}@example.test"
    challenge_response = context.request.get(base + "/api/members/signup-challenge")
    assert challenge_response.status == 200, challenge_response.text()
    challenge = challenge_response.json()
    response = context.request.post(base + "/api/members/signup", data={
        "name": name, "email": email, "password": password,
        "birthDate": ADULT_BIRTH_DATE, "ageConfirmed": True,
        "termsAccepted": True, "verificationConsent": True, "identityConsent": True,
        "challengeId": challenge["challengeId"], "answers": challenge_answers(challenge),
    })
    assert response.status == 201, response.text()
    member = response.json()["member"]
    assert member["ageVerification"]["status"] == "pending"
    return member


def approve_member(playwright, base, member_id, admin_password):
    staff = playwright.request.new_context(base_url=base)
    try:
        login = staff.post("/api/admin/login", data={"password": admin_password})
        assert login.status == 200, login.text()
        queue = staff.get("/api/admin/members/age-verifications?status=pending")
        assert queue.status == 200, queue.text()
        pending = next(member for member in queue.json()["members"] if member["id"] == member_id)
        response = staff.post(f"/api/admin/members/{member_id}/age-verification", data={
            "decision": "verified", "expectedSubmittedAt": pending["ageVerification"]["submittedAt"], "method": "in_person",
            "identityChecked": True, "ageChecked": True,
        })
        assert response.status == 200, response.text()
        assert response.json()["member"]["ageVerification"]["status"] == "verified"
        return response.json()["member"]
    finally:
        staff.dispose()


def approve_member_ui(browser, base, email, admin_password):
    """Record an explicit in-person-ID review in the local test fixture UI."""
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    try:
        workforce_sign_in(page, base, "admin", admin_password)
        page.get_by_role("tab", name="Age checks", exact=True).click()
        card = page.locator(".staff-age-card").filter(has_text=email)
        card.locator(".staff-age-summary").click()
        verify = page.get_by_role("button", name="Verify 18+ ID check", exact=True)
        expect(verify).to_be_disabled()
        page.get_by_role("checkbox", name="I checked the original valid government-issued photo ID and confirmed that its photograph, full name and date of birth match the person and application.", exact=True).check()
        expect(verify).to_be_disabled()
        page.get_by_role("checkbox", name="The original ID confirms this person is 18 years or older today.", exact=True).check()
        verify.click()
        confirmation = page.get_by_role("region", name="Confirm age check decision")
        with page.expect_response(lambda response: "/api/admin/members/" in response.url and response.url.endswith("/age-verification") and response.request.method == "POST") as result:
            confirmation.get_by_role("button", name="Confirm completed ID check", exact=True).click()
        response = result.value
        assert response.status == 200, response.text()
        reviewed = response.json()["member"]
        assert reviewed["ageVerification"]["status"] == "verified"
        queue = context.request.get(base + "/api/admin/members/age-verifications?status=verified")
        assert queue.status == 200
        row = next(member for member in queue.json()["members"] if member["id"] == reviewed["id"])
        assert not row.get("birthDate"), "A completed ID check must not retain the declared date of birth."
        page.get_by_role("group", name="Filter age checks").get_by_role("button", name="Verified", exact=True).click()
        expect(page.locator(".staff-age-card").filter(has_text=email)).to_be_visible()
        page.screenshot(path="/tmp/cana-staff-age-review.png", full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), "Staff age checks overflow on mobile."
        page.screenshot(path="/tmp/cana-staff-age-mobile.png", full_page=True)
        print("PASS actual staff ID-review confirmations, verified status, date-of-birth removal and mobile age queue", flush=True)
        return reviewed
    finally:
        context.request.post(base + "/api/admin/logout")
        context.close()


def workforce_sign_in(page, base, username, password, role=None):
    """Use the shared login page and verify its server-authorised destination."""
    page.goto(base + "/login", wait_until="networkidle")
    role = role or ("admin" if username == "admin" else "staff")
    page.get_by_label("Email or username", exact=True).fill(username)
    page.get_by_label("Password", exact=True).fill(password)
    with page.expect_response(lambda response: response.url == base + "/api/auth/login" and response.request.method == "POST") as login:
        page.get_by_role("button", name="Sign in", exact=True).click()
    assert login.value.status == 200, login.value.text()
    assert login.value.json()["role"] == role
    expect(page).to_have_url(base + ("/admin" if role == "admin" else "/staff"))
    expect(page.get_by_role("heading", name="Admin dashboard" if role == "admin" else "Staff dashboard", exact=True)).to_be_visible()
