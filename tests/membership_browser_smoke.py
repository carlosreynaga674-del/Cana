"""Exercise dedicated pages and real member accounts using a local temporary DB.

Run after ``npm run build`` with Python Playwright and /usr/bin/chromium.
The fixture binds only to loopback, keeps ordering disabled, and is removed
when the suite finishes. No production accounts or orders are created.
"""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.request
from uuid import uuid4

from playwright.sync_api import sync_playwright, expect
from browser_age_helpers import ADULT_BIRTH_DATE, fill_questions, approve_member_ui, mark_legacy_member, fill_identity_images

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = "Local-membership-test-passphrase-42"
ADMIN_PASSWORD = "local-membership-review-password-for-test"
STAFF_PASSWORD = "local-membership-worker-password-for-test"
NEW_PASSWORD = "Changed-local-membership-passphrase-84"
FIXTURE_SCRIPT = r"""
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {createServer} = await import(pathToFileURL(path.join(process.cwd(), 'server/app.mjs')));
const server = createServer({
  dbPath: process.env.LC_MEMBER_TEST_DATABASE,
  adminPassword: 'local-membership-review-password-for-test',
  staffPassword: 'local-membership-worker-password-for-test',
  identityConfig: { storageKey: '61'.repeat(32) },
  staticDir: path.join(process.cwd(), 'dist'),
  config: {
    businessName: 'Loud + Cana Local Membership Test',
    businessJurisdiction: 'Local test fixture only',
    production: false,
    liveOrdersEnabled: false,
  },
});
server.listen(Number(process.env.LC_MEMBER_TEST_PORT), '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
});
"""


def unused_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def start_fixture(database, port):
    process = subprocess.Popen(
        ["node", "--input-type=module", "-e", FIXTURE_SCRIPT],
        cwd=ROOT,
        env={**os.environ, "LC_MEMBER_TEST_DATABASE": str(database), "LC_MEMBER_TEST_PORT": str(port)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if process.poll() is not None:
            raise AssertionError(f"Local membership fixture failed: {process.stderr.read()}")
        try:
            with urllib.request.urlopen(base + "/api/config", timeout=.5) as response:
                assert json.load(response)["mode"] != "live", "This fixture must never enable ordering."
                return process, base
        except OSError:
            time.sleep(.05)
    stop_fixture(process)
    raise AssertionError("Local membership fixture did not become ready.")


def stop_fixture(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def assert_images_loaded(page):
    assert page.locator("img").evaluate_all("""async images => {
        images.forEach(image => image.loading = 'eager');
        await Promise.all(images.map(image => image.decode()));
        return images.every(image => image.complete && image.naturalWidth > 0);
    }"""), "A page image did not load."


def assert_no_overflow(page):
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), f"Horizontal overflow at {page.url}"


def assert_identity_previews(page):
    previews = page.locator("img.identity-image-preview")
    expect(previews).to_have_count(2)
    assert previews.evaluate_all("""async images => {
        await Promise.all(images.map(image => image.decode()));
        return images.every(image => image.complete && image.naturalWidth >= 200);
    }"""), "Selected ID and selfie previews must load under the real HTTP content policy."


def assert_signup_actions(page):
    """Both final-step actions must fit their panel on desktop and a phone."""
    for width, height, suffix in ((1440, 1000, "desktop"), (390, 844, "mobile")):
        page.set_viewport_size({"width": width, "height": height})
        actions = page.locator(".signup-form .signup-actions")
        actions.scroll_into_view_if_needed()
        expect(actions.get_by_role("button", name="Back", exact=True)).to_be_visible()
        expect(actions.get_by_role("button", name="Create account", exact=True)).to_be_visible()
        assert actions.evaluate("""el => {
            const panel = el.getBoundingClientRect();
            return Array.from(el.querySelectorAll('button')).every(button => {
                const rect = button.getBoundingClientRect();
                return rect.width >= 84 && rect.height >= 44 &&
                    rect.left >= panel.left - 1 && rect.right <= panel.right + 1 &&
                    rect.left >= 0 && rect.right <= innerWidth + 1 &&
                    rect.top >= 0 && rect.bottom <= innerHeight + 1;
            });
        }"""), f"Final signup buttons are clipped at {width}px."
        assert_no_overflow(page)
        actions.screenshot(path=f"/tmp/cana-signup-actions-{suffix}.png")
        page.evaluate("document.activeElement?.blur(); window.scrollTo(0, 0)")
        page.screenshot(path=f"/tmp/cana-signup-final-{suffix}.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1000})
    print("PASS final signup actions fit their panel and viewport on desktop and mobile", flush=True)


def form_field(page, label):
    return page.get_by_label(label, exact=True)


def member_state(page, base):
    response = page.request.get(base + "/api/members/me")
    assert response.status == 200, response.text()
    return response.json()["member"]


def wait_for_favorite(page, base, product_id):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        member = member_state(page, base)
        if member and product_id in member["favorites"]:
            return member
        page.wait_for_timeout(100)
    raise AssertionError("The saved favourite did not reach the member service.")


def sign_in(page, base, email, password=PASSWORD, expected_status=200):
    page.goto(base + "/login", wait_until="networkidle")
    form_field(page, "Email or username").fill(email)
    form_field(page, "Password").fill(password)
    with page.expect_response(lambda response: response.url == base + "/api/auth/login" and response.request.method == "POST") as result:
        page.get_by_role("button", name=re.compile(r"^(Sign|Log) in$", re.I)).click()
    response = result.value
    assert response.status == expected_status, response.text()
    if expected_status == 200:
        expect(page).to_have_url(base + "/account")
    else:
        expect(page.locator(".auth-error")).to_be_visible()


def sign_out(page, base):
    page.goto(base + "/account", wait_until="networkidle")
    with page.expect_response(lambda response: response.url == base + "/api/members/logout" and response.request.method == "POST") as result:
        page.get_by_role("button", name=re.compile(r"^(Sign|Log) out$", re.I)).click()
    assert result.value.status == 200
    assert member_state(page, base) is None


def run():
    assert (ROOT / "dist/index.html").exists(), "Run npm run build first."
    errors, order_posts = [], []
    email = f"member-browser-{uuid4().hex}@example.test"
    with tempfile.TemporaryDirectory(prefix="cana-membership-browser-") as directory:
        database = Path(directory) / "members.sqlite"
        port = unused_port()
        process, base = start_fixture(database, port)
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: order_posts.append(request.url) if request.method == "POST" and "/api/orders" in request.url else None)
                for route in ("/", "/shop", "/our-space", "/about", "/membership", "/contact", "/login", "/signup", "/account", "/privacy", "/terms", "/responsible-use", "/help", "/this-page-does-not-exist"):
                    response = page.goto(base + route, wait_until="networkidle")
                    assert response.status == 200, f"SPA route {route} failed to load."
                    expect(page.locator("main")).to_be_visible()
                    expect(page.locator("main h1")).to_have_count(1)
                    assert_no_overflow(page)
                    assert_images_loaded(page)
                    page.reload(wait_until="networkidle")
                    expect(page.locator("main h1")).to_have_count(1)
                page.goto(base, wait_until="networkidle")
                nav = page.get_by_role("navigation", name="Main navigation")
                for name, route in (("Shop", "/shop"), ("Our Space", "/our-space"), ("About", "/about"), ("Membership", "/membership"), ("Contact", "/contact"), ("Home", "/")):
                    nav.get_by_role("link", name=name, exact=True).click()
                    expect(page).to_have_url(base + route)
                    expect(nav.get_by_role("link", name=name, exact=True)).to_have_attribute("aria-current", "page")
                nav.get_by_role("link", name="About", exact=True).click()
                nav.get_by_role("link", name="Contact", exact=True).click()
                page.go_back(wait_until="networkidle")
                expect(page).to_have_url(base + "/about")
                page.go_forward(wait_until="networkidle")
                expect(page).to_have_url(base + "/contact")
                print("PASS all dedicated pages, direct loads, refresh, active navigation, browser back/forward, images and desktop layout", flush=True)

                page.goto(base + "/our-space", wait_until="networkidle")
                page.get_by_role("button", name=re.compile("Open gallery image:", re.I)).first.click()
                gallery = page.get_by_role("dialog", name="Loud + Cana store gallery")
                expect(gallery).to_be_visible()
                gallery.get_by_role("button", name="Next gallery image").click()
                expect(gallery.get_by_role("heading")).to_have_text("The collection")
                gallery.get_by_role("button", name="Next gallery image").click()
                expect(gallery.locator("img")).to_have_attribute("src", re.compile("reference-space-3"))
                gallery.get_by_role("button", name="Next gallery image").click()
                expect(gallery.get_by_role("heading")).to_have_text("The welcome")
                gallery.get_by_role("button", name="Previous gallery image").click()
                expect(gallery.locator("img")).to_have_attribute("src", re.compile("reference-space-3"))
                gallery.get_by_role("button", name="Close dialog").click()
                for index in (1, 2):
                    page.locator(".page-gallery-card").nth(index).click()
                    expect(gallery.locator("img")).to_have_attribute("src", re.compile(f"reference-space-{index + 1}"))
                    gallery.get_by_role("button", name="Close dialog").click()

                page.goto(base + "/signup", wait_until="networkidle")
                page.get_by_role("button", name="Continue", exact=True).click()
                expect(page.locator(".auth-field-error").first).to_be_visible()
                form_field(page, "Full name").fill("Local Browser Member")
                form_field(page, "Email address").fill("not-an-email")
                page.get_by_role("button", name="Continue", exact=True).click()
                expect(page.locator(".auth-field-error").first).to_be_visible()
                form_field(page, "Email address").fill(email)
                form_field(page, "Password").fill(PASSWORD)
                page.get_by_role("button", name="Show password", exact=True).click()
                expect(form_field(page, "Password")).to_have_attribute("type", "text")
                page.get_by_role("button", name="Hide password", exact=True).click()
                expect(form_field(page, "Password")).to_have_attribute("type", "password")
                form_field(page, "Confirm password").fill("a-different-local-password")
                page.get_by_role("button", name="Continue", exact=True).click()
                expect(page.get_by_text("Your passwords do not match.", exact=True)).to_be_visible()
                form_field(page, "Confirm password").fill(PASSWORD)
                page.get_by_role("button", name="Continue", exact=True).click()
                form_field(page, "Date of birth").fill("2015-01-01")
                page.get_by_role("checkbox", name=re.compile("I confirm I am 18")).check()
                page.get_by_role("checkbox", name=re.compile("I consent to my date of birth")).check()
                page.get_by_role("button", name="Continue", exact=True).click()
                expect(page.locator(".auth-field-error").first).to_be_visible()
                assert member_state(page, base) is None, "An under-18 declaration must not create an account."
                form_field(page, "Date of birth").fill(ADULT_BIRTH_DATE)
                page.get_by_role("button", name="Continue", exact=True).click()
                expect(page.locator("fieldset.age-question")).to_have_count(3)
                before = page.locator("fieldset.age-question").evaluate_all("items => items.map(item => [item.querySelector('input').name, ...Array.from(item.querySelectorAll('input')).map(r => r.value)])")
                with page.expect_response(lambda response: "/api/members/signup-challenge" in response.url and response.request.method == "GET") as refreshed:
                    page.get_by_role("button", name="Get new questions", exact=True).click()
                assert refreshed.value.status == 200
                expected_questions = [["answer-" + question["id"], *[choice["id"] for choice in question["choices"]]] for question in refreshed.value.json()["questions"]]
                page.wait_for_function("expected => JSON.stringify(Array.from(document.querySelectorAll('fieldset.age-question')).map(item => [item.querySelector('input').name, ...Array.from(item.querySelectorAll('input')).map(r => r.value)])) === JSON.stringify(expected)", arg=expected_questions)
                assert before != expected_questions, "A new challenge should rotate the question/choice order."
                fill_questions(page, correct=False)
                fill_identity_images(page)
                assert_identity_previews(page)
                page.locator('input[name="identityConsent"]').check()
                page.locator('input[name="termsAccepted"]').check()
                with page.expect_response(lambda response: response.url == base + "/api/members/signup" and response.request.method == "POST") as rejected_quiz:
                    page.get_by_role("button", name="Create account", exact=True).click()
                assert rejected_quiz.value.status == 422, rejected_quiz.value.text()
                assert member_state(page, base) is None
                fill_questions(page)
                assert_signup_actions(page)
                page.screenshot(path="/tmp/cana-membership-signup.png", full_page=True)
                with page.expect_response(lambda response: response.url == base + "/api/members/signup" and response.request.method == "POST") as signup:
                    page.get_by_role("button", name="Create account", exact=True).click()
                assert signup.value.status == 201, signup.value.text()
                expect(page).to_have_url(base + "/account")
                expect(form_field(page, "Full name")).to_have_value("Local Browser Member")
                member = member_state(page, base)
                assert member["email"] == email
                assert member["ageVerification"]["status"] == "pending"
                assert member["identityVerification"]["required"] is True
                assert member["identityVerification"]["status"] != "verified"
                # The remainder deliberately covers legacy manual review. Newly
                # registered accounts above retain the upload-and-review gate.
                mark_legacy_member(database, member["id"])
                page.reload(wait_until="networkidle")
                assert "birthDate" not in member
                expect(page.get_by_text("ID check pending", exact=True)).to_be_visible()
                expect(page.get_by_text("18+ ID checked", exact=True)).to_have_count(0)
                assert not any(key in member for key in ("password", "passwordHash", "password_hash")), member
                session_cookies = [cookie for cookie in context.cookies() if cookie["name"] == "lc_member" and cookie["path"] == "/api"]
                assert session_cookies and all(cookie["httpOnly"] for cookie in session_cookies), "Member sessions must use HttpOnly cookies."
                page.reload(wait_until="networkidle")
                expect(page).to_have_url(base + "/account")
                expect(page.locator("main")).to_contain_text(email)
                print("PASS adult date checks, random fresh questionnaire, wrong-answer rejection, pending account and real cookie session", flush=True)

                form_field(page, "Full name").fill("Updated Browser Member")
                with page.expect_response(lambda response: response.url == base + "/api/members/me" and response.request.method == "PATCH") as profile:
                    page.get_by_role("button", name=re.compile("Save profile|Save changes", re.I)).click()
                assert profile.value.status == 200, profile.value.text()
                assert member_state(page, base)["name"] == "Updated Browser Member"
                assert member_state(page, base)["ageVerification"]["status"] == "required", "Changing the identity name must invalidate the previous age submission."
                page.get_by_role("button", name="Complete age check", exact=True).click()
                form_field(page, "Date of birth").fill(ADULT_BIRTH_DATE)
                page.get_by_role("checkbox", name=re.compile("I confirm I am 18")).check()
                page.get_by_role("checkbox", name=re.compile("I consent to my date of birth")).check()
                fill_questions(page)
                with page.expect_response(lambda response: response.url == base + "/api/members/age-verification" and response.request.method == "POST") as renewed:
                    page.get_by_role("button", name="Submit for ID review", exact=True).click()
                assert renewed.value.status == 200, renewed.value.text()
                expect(page.get_by_text("ID check pending", exact=True)).to_be_visible()
                approve_member_ui(browser, base, email, ADMIN_PASSWORD)
                page.reload(wait_until="networkidle")
                expect(page.get_by_text("18+ ID checked", exact=True)).to_be_visible()
                assert member_state(page, base)["ageVerification"]["status"] == "verified"
                page.goto(base + "/shop", wait_until="networkidle")
                expect(page.locator(".product-card")).to_have_count(28)
                for category, count in (("Flower", 6), ("Pre-rolls", 5), ("Edibles", 5), ("Vapes", 4), ("Drinks", 4), ("Accessories", 4)):
                    page.get_by_role("group", name="Product categories").get_by_role("button", name=category, exact=True).click()
                    expect(page.locator(".product-card")).to_have_count(count)
                page.get_by_role("group", name="Product categories").get_by_role("button").first.click()
                page.get_by_label("Search products").fill("Sunset Sherbet")
                expect(page.locator(".product-card")).to_have_count(1)
                page.get_by_role("button", name="Save Sunset Sherbet", exact=True).click()
                wait_for_favorite(page, base, "sunset-sherbet")
                page.goto(base + "/account", wait_until="networkidle")
                page.screenshot(path="/tmp/cana-membership-account.png", full_page=True)
                sign_out(page, base)
                sign_in(page, base, email, "incorrect-local-password", expected_status=401)
                sign_in(page, base, email)
                assert member_state(page, base)["name"] == "Updated Browser Member"
                assert "sunset-sherbet" in member_state(page, base)["favorites"]
                print("PASS profile editing, catalog filters/search, server-saved favourites, logout and failed/successful login", flush=True)

                form_field(page, "Current password").fill(PASSWORD)
                form_field(page, "New password").fill(NEW_PASSWORD)
                form_field(page, "Confirm new password").fill(NEW_PASSWORD)
                with page.expect_response(lambda response: response.url == base + "/api/members/password" and response.request.method == "POST") as password:
                    page.get_by_role("button", name=re.compile("Change password|Update password", re.I)).click()
                assert password.value.status == 200, password.value.text()
                sign_out(page, base)
                sign_in(page, base, email, PASSWORD, expected_status=401)
                sign_in(page, base, email, NEW_PASSWORD)

                fresh_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                fresh = fresh_context.new_page()
                fresh.on("pageerror", lambda error: errors.append(str(error)))
                sign_in(fresh, base, email, NEW_PASSWORD)
                assert "sunset-sherbet" in member_state(fresh, base)["favorites"]
                fresh.goto(base + "/shop?favorites=1", wait_until="networkidle")
                expect(fresh.get_by_role("button", name="Unsave Sunset Sherbet", exact=True)).to_be_visible()
                expect(fresh.locator(".product-card")).to_have_count(1)
                stop_fixture(process)
                process, _ = start_fixture(database, port)
                fresh.goto(base + "/account", wait_until="networkidle")
                expect(form_field(fresh, "Full name")).to_have_value("Updated Browser Member")
                assert "sunset-sherbet" in member_state(fresh, base)["favorites"]
                print("PASS password changes, independent-browser account/favourites and SQLite/session persistence after server restart", flush=True)

                mobile_context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
                mobile = mobile_context.new_page()
                mobile.on("pageerror", lambda error: errors.append(str(error)))
                mobile.goto(base, wait_until="networkidle")
                mobile.get_by_role("button", name="Toggle navigation").click()
                mobile.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Membership", exact=True).click()
                expect(mobile).to_have_url(base + "/membership")
                expect(mobile.get_by_role("button", name="Toggle navigation")).to_have_attribute("aria-expanded", "false")
                for route in ("/membership", "/signup", "/login", "/account", "/shop", "/our-space", "/about", "/contact", "/privacy", "/terms", "/responsible-use", "/help"):
                    mobile.goto(base + route, wait_until="networkidle")
                    expect(mobile.locator("main h1")).to_have_count(1)
                    assert_no_overflow(mobile)
                sign_in(mobile, base, email, NEW_PASSWORD)
                assert_no_overflow(mobile)
                mobile.screenshot(path="/tmp/cana-membership-mobile.png", full_page=True)
                print("PASS mobile navigation, all page layouts, login and account usability without horizontal overflow", flush=True)

                # Clean up the fictitious local account, also checking that deletion revokes sessions.
                mobile.get_by_text("Close your account", exact=True).click()
                form_field(mobile, "Confirm your password").fill(NEW_PASSWORD)
                mobile.get_by_role("checkbox", name="I understand that closing my account is permanent.").check()
                with mobile.expect_response(lambda response: response.url == base + "/api/members/me" and response.request.method == "DELETE") as deletion:
                    mobile.get_by_role("button", name="Permanently close account", exact=True).click()
                assert deletion.value.status == 200, deletion.value.text()
                expect(mobile).to_have_url(base + "/membership")
                assert member_state(fresh, base) is None
                mobile_context.close()
                fresh_context.close()
                context.close()
                browser.close()
                assert not errors, errors
                assert not order_posts, f"The membership suite must not submit orders: {order_posts}"
                print("PASS account deletion, session revocation, zero browser errors and zero order submissions", flush=True)
        finally:
            stop_fixture(process)


if __name__ == "__main__":
    run()
