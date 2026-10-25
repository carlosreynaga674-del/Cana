"""Check digital membership cards on an isolated service with sales disabled.

Run after the shared production build. Uses synthetic images and local-only
accounts; never sends production mail, submits orders or changes a real member.
"""
import base64
from pathlib import Path
import re
import tempfile
from uuid import uuid4
import xml.etree.ElementTree as ET

from playwright.sync_api import sync_playwright, expect
from browser_age_helpers import (
    ADULT_BIRTH_DATE,
    challenge_answers,
    register_member,
    synthetic_identity_images,
)
from membership_browser_smoke import (
    ADMIN_PASSWORD,
    assert_no_overflow,
    sign_in,
    sign_out,
    start_fixture,
    stop_fixture,
    unused_port,
)


NUMBER = re.compile(r"^LC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$")
PASSWORD = "Local membership card fixture passphrase 42"


def account(context, base):
    response = context.request.get(base + "/api/members/me")
    assert response.status == 200, response.text()
    return response.json()["member"]


def upload_identity(context, base):
    response = context.request.post(base + "/api/members/identity-verification", data={
        "identityConsent": True,
        **{key: {"data": base64.b64encode(content).decode()} for key, content in synthetic_identity_images().items()},
    })
    assert response.status == 200, response.text()
    return response.json()["verification"]


def review(admin, base, member_id, verification, decision):
    body = {
        "method": "uploaded_id_selfie", "decision": decision,
        "expectedUploadId": verification["uploadId"],
        "expectedSubmittedAt": verification["submittedAt"],
    }
    if decision == "verified":
        body.update(identityChecked=True, ageChecked=True)
    else:
        body["reason"] = "unable_to_verify"
    response = admin.request.post(base + f"/api/admin/members/{member_id}/age-verification", data=body)
    assert response.status == 200, response.text()
    return response.json()["member"]


def resubmit(context, base):
    response = context.request.get(base + "/api/members/signup-challenge")
    assert response.status == 200, response.text()
    challenge = response.json()
    response = context.request.post(base + "/api/members/age-verification", data={
        "birthDate": ADULT_BIRTH_DATE,
        "ageConfirmed": True, "termsAccepted": True,
        "verificationConsent": True, "identityConsent": True,
        "challengeId": challenge["challengeId"],
        "answers": challenge_answers(challenge),
    })
    assert response.status == 200, response.text()


def assert_card(page, number, state, label):
    card = page.get_by_role("article", name="Digital membership card", exact=True)
    expect(card).to_be_visible()
    expect(card.locator(".digital-card-number strong")).to_have_text(number)
    expect(card.locator(".member-card-status")).to_have_attribute("data-verification-status", state)
    expect(card.locator(".member-card-status")).to_have_text(label)
    return card


def assert_approved_dashboard(page, number):
    assert_card(page, number, "verified", "Verified member")
    expect(page.locator("#member-verification")).to_have_count(0)
    expect(page.get_by_role("heading", name="Your ID & selfie review", exact=True)).to_have_count(0)
    expect(page.get_by_role("button", name="Refresh review status", exact=True)).to_have_count(0)
    expect(page.get_by_role("link", name="View verification details", exact=True)).to_have_count(0)
    expect(page.get_by_role("progressbar", name="Membership setup progress")).to_have_count(0)
    expect(page.get_by_role("link", name="Manage your profile", exact=True)).to_be_visible()


def refresh_review(page, base):
    button = page.get_by_role("button", name="Refresh review status", exact=True)
    expect(button).to_be_enabled()
    with page.expect_response(lambda response: response.url == base + "/api/members/me" and response.request.method == "GET") as refreshed:
        button.click()
    assert refreshed.value.status == 200, refreshed.value.text()


def run():
    errors, forbidden_writes = [], []
    # Literal markup in the member's name must remain inert in HTML and SVG.
    name = 'Card <script>alert("fixture")</script> & Member'
    email = f"card-browser-{uuid4().hex}@example.test"
    with tempfile.TemporaryDirectory(prefix="cana-member-card-browser-") as directory:
        process, base = start_fixture(Path(directory) / "cards.sqlite", unused_port())
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
                context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
                context.on("request", lambda request: forbidden_writes.append(request.url) if request.method != "GET" and "/api/orders" in request.url else None)
                member = register_member(context, base, PASSWORD, name=name, email=email)
                number = member["membershipNumber"]
                assert NUMBER.fullmatch(number), number
                second = browser.new_context()
                other = register_member(second, base, PASSWORD)
                assert NUMBER.fullmatch(other["membershipNumber"])
                assert other["membershipNumber"] != number
                second.close()
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("dialog", lambda dialog: (errors.append("Unexpected executable dialog: " + dialog.message), dialog.dismiss()))
                page.goto(base + "/account", wait_until="networkidle")
                card = assert_card(page, number, "required", "ID upload needed")
                expect(card.locator("h3")).to_have_text(name)
                expect(page.get_by_role("progressbar", name="Membership setup progress")).to_have_attribute("aria-valuenow", "1")
                assert_no_overflow(page)
                page.screenshot(path="/tmp/cana-member-card-desktop.png", full_page=True)
                page.reload(wait_until="networkidle")
                assert_card(page, number, "required", "ID upload needed")
                assert account(context, base)["membershipNumber"] == number
                page.get_by_role("button", name="Copy membership number", exact=True).click()
                expect(page.get_by_role("status").filter(has_text="Membership number copied.")).to_be_visible()
                assert page.evaluate("navigator.clipboard.readText()") == number
                with page.expect_download() as saved:
                    page.get_by_role("button", name="Download membership card", exact=True).click()
                download = saved.value
                assert download.suggested_filename == f"loud-cana-membership-{number}.svg"
                svg = Path(download.path()).read_text()
                root = ET.fromstring(svg)
                allowed = {"svg", "title", "rect", "circle", "text", "line"}
                for node in root.iter():
                    assert node.tag.rsplit("}", 1)[-1] in allowed, node.tag
                    for key, value in node.attrib.items():
                        key = key.rsplit("}", 1)[-1].lower()
                        assert not key.startswith("on"), key
                        assert key not in {"href", "src", "style"}, (key, value)
                        assert "http:" not in value and "https:" not in value
                texts = list(root.itertext())
                assert name in texts and number in texts
                assert "ID upload needed" in texts
                assert "Not proof of age or identity" in svg
                assert "&lt;script&gt;" in svg and "&amp;" in svg
                assert email not in svg and ADULT_BIRTH_DATE not in svg and PASSWORD not in svg
                assert "<!DOCTYPE" not in svg and "document_blob" not in svg and "selfie" not in svg
                print("PASS unique stable membership numbers, safe literal-name SVG download and clipboard copy", flush=True)

                verification = upload_identity(context, base)
                page.reload(wait_until="networkidle")
                assert_card(page, number, "pending", "Verification pending")
                expect(page.locator("#member-verification")).to_be_visible()
                expect(page.get_by_role("progressbar", name="Membership setup progress")).to_have_attribute("aria-valuenow", "2")
                admin = browser.new_context()
                login = admin.request.post(base + "/api/auth/login", data={"identifier": "admin", "password": ADMIN_PASSWORD})
                assert login.status == 200, login.text()
                review(admin, base, member["id"], verification, "rejected")
                page.reload(wait_until="networkidle")
                assert_card(page, number, "rejected", "Review not approved")
                expect(page.locator("#member-verification")).to_be_visible()
                expect(page.get_by_role("progressbar", name="Membership setup progress")).to_have_attribute("aria-valuenow", "2")
                resubmit(context, base)
                verification = upload_identity(context, base)
                page.reload(wait_until="networkidle")
                assert_card(page, number, "pending", "Verification pending")
                reviewed = review(admin, base, member["id"], verification, "verified")
                assert reviewed["membershipNumber"] == number
                refresh_review(page, base)
                assert_approved_dashboard(page, number)
                page.reload(wait_until="networkidle")
                assert_approved_dashboard(page, number)
                sign_out(page, base)
                sign_in(page, base, email, PASSWORD)
                assert_approved_dashboard(page, number)
                page.set_viewport_size({"width": 390, "height": 844})
                assert_no_overflow(page)
                assert_approved_dashboard(page, number)
                page.screenshot(path="/tmp/cana-member-card-mobile.png", full_page=True)
                with page.expect_response(lambda response: response.url == base + "/api/members/me" and response.request.method == "PATCH") as update:
                    page.get_by_label("Full name", exact=True).fill("Local Card Dashboard Member")
                    page.get_by_role("button", name="Save profile", exact=True).click()
                assert update.value.status == 200, update.value.text()
                changed = update.value.json()["member"]
                assert changed["membershipNumber"] == number
                card = assert_card(page, number, "required", "Verification required")
                expect(card.locator("h3")).to_have_text("Local Card Dashboard Member")
                expect(page.locator("#member-verification")).to_be_visible()
                expect(page.get_by_role("link", name="View verification details", exact=True)).to_be_visible()
                expect(page.get_by_role("progressbar", name="Membership setup progress")).to_have_attribute("aria-valuenow", "1")
                page.reload(wait_until="networkidle")
                assert_card(page, number, "required", "Verification required")
                assert_no_overflow(page)
                print("PASS admin approval removes completed review, reload/login keeps it hidden, and a name change restores required steps", flush=True)

                # A separately authenticated employee approval has the same
                # member-facing result as an administrator approval.
                employee_username = "card.reviewer." + uuid4().hex[:8]
                employee_password = "Local card reviewer passphrase 42"
                created = admin.request.post(base + "/api/admin/staff", data={
                    "name": "Local Card Reviewer", "username": employee_username,
                    "password": employee_password,
                })
                assert created.status == 201, created.text()
                worker = browser.new_context()
                login = worker.request.post(base + "/api/auth/login", data={
                    "identifier": employee_username, "password": employee_password,
                })
                assert login.status == 200 and login.json()["role"] == "staff", login.text()
                resubmit(context, base)
                verification = upload_identity(context, base)
                page.reload(wait_until="networkidle")
                assert_card(page, number, "pending", "Verification pending")
                review(worker, base, member["id"], verification, "verified")
                refresh_review(page, base)
                assert_approved_dashboard(page, number)
                assert account(context, base)["membershipNumber"] == number
                assert_no_overflow(page)
                page.screenshot(path="/tmp/cana-approved-member-dashboard-mobile.png", full_page=True)
                page.set_viewport_size({"width": 1440, "height": 1000})
                assert_no_overflow(page)
                page.screenshot(path="/tmp/cana-approved-member-dashboard-desktop.png", full_page=True)
                print("PASS individual staff approval also hides completed review on mobile and desktop, with a stable membership number", flush=True)
                worker.close()
                admin.close()
                context.close()
                browser.close()
        finally:
            stop_fixture(process)
    assert not errors, errors
    assert not forbidden_writes, forbidden_writes
    print("PASS member card has zero uncaught browser errors, production mail or order submissions", flush=True)


if __name__ == "__main__":
    run()
