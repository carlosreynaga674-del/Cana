"""Private merchandise payment-settings check using an isolated local database.

All bank information is an obvious synthetic fixture. This suite does not
connect a bank, initiate payments, submit orders or alter production settings.
"""
from pathlib import Path
import tempfile

from playwright.sync_api import expect, sync_playwright
from membership_browser_smoke import (
    ROOT, ADMIN_PASSWORD, STAFF_PASSWORD, PASSWORD, start_fixture, stop_fixture,
    unused_port, assert_no_overflow,
)
from browser_age_helpers import workforce_sign_in, register_member

ENDPOINT = "/api/admin/merchandise-payment-details"
DETAILS = {
    "bankName": "Synthetic Browser Fixture Bank",
    "accountHolder": "Local Merchandise Browser Fixture",
    "accountNumber": "001234567890", "branchCode": "001234",
    "accountType": "business", "reference": "Local membership reference",
    "instructions": "Private fixture record; no payment is requested.",
}
LABELS = {
    "bankName": "Bank name", "accountHolder": "Account holder",
    "accountNumber": "Account number", "branchCode": "Branch code",
    "accountType": "Account type", "reference": "Payment reference",
    "instructions": "Payment note",
}


def checked(response, status=200):
    assert response.status == status, response.text()
    return response.json()


def fill_details(page, details):
    for field, value in details.items():
        control = page.get_by_label(LABELS[field], exact=True)
        if field == "accountType":
            control.select_option(value)
        else:
            control.fill(value)


def run():
    assert (ROOT / "dist/index.html").exists(), "Run npm run build first."
    errors, order_posts = [], []
    with tempfile.TemporaryDirectory(prefix="cana-private-payment-browser-") as directory:
        process, base = start_fixture(Path(directory) / "fixture.sqlite", unused_port())
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                admin_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                admin = admin_context.new_page()
                admin.on("pageerror", lambda error: errors.append(str(error)))
                admin.on("request", lambda request: order_posts.append(request.url) if request.method == "POST" and "/api/orders" in request.url else None)
                workforce_sign_in(admin, base, "admin", ADMIN_PASSWORD)
                admin.get_by_role("tab", name="Payment details", exact=True).click()
                expect(admin.get_by_role("heading", name="Merchandise payment details", exact=True)).to_be_visible()
                expect(admin.get_by_label("Account number", exact=True)).to_have_value("")
                initial = checked(admin_context.request.get(base + ENDPOINT))
                assert initial["configured"] is False
                assert initial["scope"] == "non_cannabis_merchandise"
                fill_details(admin, DETAILS)
                admin.set_viewport_size({"width": 390, "height": 844})
                assert_no_overflow(admin)
                admin.screenshot(path="/tmp/cana-private-payment-details-mobile.png", full_page=True)
                with admin.expect_response(lambda response: response.url == base + ENDPOINT and response.request.method == "PUT") as saved:
                    admin.get_by_role("button", name="Save payment details", exact=True).click()
                result = checked(saved.value)
                assert result["details"] == DETAILS
                assert result["configured"] is True and result["revision"] == 2
                expect(admin.get_by_label("Account number", exact=True)).to_have_value("001234567890")
                expect(admin.get_by_label("Branch code", exact=True)).to_have_value("001234")
                admin.reload(wait_until="networkidle")
                admin.get_by_role("tab", name="Payment details", exact=True).click()
                for key, value in DETAILS.items():
                    expect(admin.get_by_label(LABELS[key], exact=True)).to_have_value(value)
                assert_no_overflow(admin)
                print("PASS private admin form, exact leading-zero account/branch strings, successful save/reload and mobile layout", flush=True)

                admin.get_by_label("Bank name", exact=True).fill("An unsaved local edit")
                admin.get_by_role("button", name="Reset changes", exact=True).click()
                expect(admin.get_by_label("Bank name", exact=True)).to_have_value(DETAILS["bankName"])
                assert checked(admin_context.request.get(base + ENDPOINT))["revision"] == 2
                admin.get_by_label("Account number", exact=True).fill("ABC123")
                admin.get_by_role("button", name="Save payment details", exact=True).click()
                expect(admin.get_by_label("Account number", exact=True)).to_have_attribute("aria-invalid", "true")
                assert checked(admin_context.request.get(base + ENDPOINT))["revision"] == 2
                admin.get_by_role("button", name="Reset changes", exact=True).click()

                # A separate administrator write must require a deliberate
                # latest-version reload instead of silently losing edits.
                admin.get_by_label("Payment note", exact=True).fill("Unsaved local note")
                remote = {**DETAILS, "bankName": "Revised Synthetic Fixture Bank"}
                checked(admin_context.request.put(base + ENDPOINT, data={"details": remote, "expectedRevision": 2}))
                with admin.expect_response(lambda response: response.url == base + ENDPOINT and response.request.method == "PUT") as conflicted:
                    admin.get_by_role("button", name="Save payment details", exact=True).click()
                checked(conflicted.value, 409)
                expect(admin.get_by_label("Payment note", exact=True)).to_have_value("Unsaved local note")
                expect(admin.get_by_role("button", name="Save payment details", exact=True)).to_be_disabled()
                admin.get_by_role("button", name="Load latest details", exact=True).click()
                expect(admin.get_by_label("Bank name", exact=True)).to_have_value(remote["bankName"])
                expect(admin.get_by_label("Payment note", exact=True)).to_have_value(DETAILS["instructions"])
                assert_no_overflow(admin)
                print("PASS validation, reset without writes and stale-version conflict preserves local edits until explicit reload", flush=True)

                worker_context = browser.new_context(viewport={"width": 390, "height": 844})
                worker = worker_context.new_page()
                worker.on("pageerror", lambda error: errors.append(str(error)))
                workforce_sign_in(worker, base, "staff", STAFF_PASSWORD)
                expect(worker.get_by_role("tab", name="Payment details", exact=True)).to_have_count(0)
                checked(worker_context.request.get(base + ENDPOINT), 403)
                checked(worker_context.request.put(base + ENDPOINT, data={"details": DETAILS, "expectedRevision": 3}), 403)
                member_context = browser.new_context()
                register_member(member_context, base, PASSWORD, name="Private Settings Browser Member")
                checked(member_context.request.get(base + ENDPOINT), 401)
                for route in ("/api/config", "/api/products", "/api/members/me"):
                    response = member_context.request.get(base + route)
                    assert response.status == 200
                    assert DETAILS["accountNumber"] not in response.text()
                    assert remote["bankName"] not in response.text()
                assert errors == [], errors
                assert order_posts == [], "This suite must not submit an order."
                print("PASS staff/member exclusion, public-data privacy, zero JavaScript errors and no order submissions", flush=True)
                browser.close()
        finally:
            stop_fixture(process)


if __name__ == "__main__":
    run()
