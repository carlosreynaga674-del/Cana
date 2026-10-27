"""Exercise private member address books against an isolated local service.

Run after the production build. Sales remain disabled; accounts and delivery
addresses are synthetic. No orders, real identity uploads or mail are sent.
"""
from pathlib import Path
import tempfile

from playwright.sync_api import expect, sync_playwright
from browser_age_helpers import register_member
from membership_browser_smoke import (
    ROOT, PASSWORD, STAFF_PASSWORD, start_fixture, stop_fixture, unused_port,
    assert_no_overflow, sign_in, sign_out,
)

ENDPOINT = "/api/members/addresses"
HOME = {"label": "Home fixture", "address": "12 Local Fixture Street",
        "city": "Fixture City", "postcode": "0001"}
WORK = {"label": "Work fixture", "address": "24 Local Fixture Avenue",
        "city": "Fixture City", "postcode": "0181"}
FAMILY = {"label": "Family fixture", "address": "36 Local Fixture Road",
          "city": "Fixture Town", "postcode": "2196"}
LABELS = {"label": "Address label", "address": "Street address",
          "city": "City", "postcode": "Postal code"}


def checked(response, status=200):
    assert response.status == status, response.text()
    return response.json()


def addresses(context, base):
    data = checked(context.request.get(base + ENDPOINT))
    assert data["limit"] == 3
    return data["addresses"]


def card(page, label):
    return page.locator("article.member-address-card").filter(
        has=page.get_by_role("heading", name=label, exact=True))


def fill_address(form, value):
    for field, text in value.items():
        form.get_by_label(LABELS[field], exact=True).fill(text)


def add_address(page, base, value, invalid_postcode=False):
    book = page.locator(".member-address-book")
    book.get_by_role("button", name="Add address", exact=True).click()
    form = book.get_by_role("region", name="Add address", exact=True)
    expect(form).to_be_visible()
    fill_address(form, value)
    if invalid_postcode:
        form.get_by_label("Postal code", exact=True).fill("ABC")
        form.get_by_role("button", name="Save address", exact=True).click()
        expect(form.get_by_label("Postal code", exact=True)).to_have_attribute("aria-invalid", "true")
        form.get_by_label("Postal code", exact=True).fill(value["postcode"])
    with page.expect_response(lambda response: response.url == base + ENDPOINT and response.request.method == "POST") as saved:
        form.get_by_role("button", name="Save address", exact=True).click()
    result = checked(saved.value, 201)["address"]
    for field, text in value.items():
        assert result[field] == text, (field, result)
    expect(form).not_to_be_visible()
    expect(card(page, value["label"])).to_be_visible()
    return result


def run():
    assert (ROOT / "dist/index.html").exists(), "Run npm run build first."
    errors, order_posts = [], []
    with tempfile.TemporaryDirectory(prefix="cana-member-address-browser-") as directory:
        process, base = start_fixture(Path(directory) / "fixture.sqlite", unused_port())
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                context.on("request", lambda request: order_posts.append(request.url)
                           if request.method == "POST" and "/api/orders" in request.url else None)
                member = register_member(context, base, PASSWORD, name="Local Address Book Member")
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(base + "/account", wait_until="networkidle")
                book = page.locator(".member-address-book")
                expect(book.get_by_role("heading", name="Saved addresses", exact=True)).to_be_visible()
                assert addresses(context, base) == []
                home = add_address(page, base, HOME, invalid_postcode=True)
                add_address(page, base, WORK)
                add_address(page, base, FAMILY)
                expect(page.locator("article.member-address-card")).to_have_count(3)
                expect(book.get_by_role("button", name="Add address", exact=True)).to_be_disabled()
                saved = addresses(context, base)
                assert len(saved) == 3
                assert next(item for item in saved if item["id"] == home["id"])["postcode"] == "0001"
                page.reload(wait_until="networkidle")
                expect(page.locator("article.member-address-card")).to_have_count(3)
                expect(card(page, HOME["label"])).to_contain_text("0001")
                assert_no_overflow(page)
                print("PASS member-only address creation, validation, three-address limit, leading-zero postcode and reload persistence", flush=True)

                card(page, HOME["label"]).get_by_role("button", name="Edit address", exact=True).click()
                editor = book.get_by_role("region", name="Edit address", exact=True)
                edited = {**HOME, "address": "14 Local Fixture Street"}
                fill_address(editor, edited)
                with page.expect_response(lambda response: response.url == base + ENDPOINT + "/" + home["id"] and response.request.method == "PATCH") as changed:
                    editor.get_by_role("button", name="Save changes", exact=True).click()
                updated = checked(changed.value)["address"]
                assert updated["address"] == edited["address"] and updated["revision"] == home["revision"] + 1
                expect(card(page, HOME["label"])).to_contain_text(edited["address"])

                # A concurrent browser/session save must not silently overwrite
                # this user's unfinished local address edit.
                card(page, HOME["label"]).get_by_role("button", name="Edit address", exact=True).click()
                editor = book.get_by_role("region", name="Edit address", exact=True)
                editor.get_by_label("Street address", exact=True).fill("Unsaved local fixture address")
                remote = {**edited, "address": "16 Concurrent Fixture Street"}
                checked(context.request.patch(base + ENDPOINT + "/" + home["id"],
                        data={**remote, "expectedRevision": updated["revision"]}))
                with page.expect_response(lambda response: response.url == base + ENDPOINT + "/" + home["id"] and response.request.method == "PATCH") as conflict:
                    editor.get_by_role("button", name="Save changes", exact=True).click()
                checked(conflict.value, 409)
                expect(editor.get_by_label("Street address", exact=True)).to_have_value("Unsaved local fixture address")
                book.get_by_role("button", name="Load latest address", exact=True).click()
                expect(editor.get_by_label("Street address", exact=True)).to_have_value(remote["address"])
                editor.get_by_role("button", name="Cancel", exact=True).click()
                expect(card(page, HOME["label"])).to_contain_text(remote["address"])
                print("PASS editing and stale revision protection preserve local changes until an explicit latest-address reload", flush=True)

                work = card(page, WORK["label"])
                work.get_by_role("button", name="Remove address", exact=True).click()
                expect(work.get_by_role("button", name="Confirm removal", exact=True)).to_be_visible()
                assert len(addresses(context, base)) == 3, "Opening removal confirmation must not delete."
                work.get_by_role("button", name="Keep address", exact=True).click()
                expect(work).to_be_visible()
                work.get_by_role("button", name="Remove address", exact=True).click()
                with page.expect_response(lambda response: response.url.startswith(base + ENDPOINT + "/") and response.request.method == "DELETE") as removed:
                    work.get_by_role("button", name="Confirm removal", exact=True).click()
                assert checked(removed.value)["ok"] is True
                expect(page.locator("article.member-address-card")).to_have_count(2)
                expect(book.get_by_role("button", name="Add address", exact=True)).to_be_enabled()
                page.set_viewport_size({"width": 390, "height": 844})
                assert_no_overflow(page)
                card(page, FAMILY["label"]).get_by_role("button", name="Edit address", exact=True).click()
                expect(book.get_by_role("region", name="Edit address", exact=True)).to_be_visible()
                assert_no_overflow(page)
                book.screenshot(path="/tmp/cana-member-addresses-mobile.png")
                book.get_by_role("region", name="Edit address", exact=True).get_by_role("button", name="Cancel", exact=True).click()
                sign_out(page, base)
                sign_in(page, base, member["email"])
                expect(page.locator("article.member-address-card")).to_have_count(2)
                expect(card(page, HOME["label"])).to_contain_text(remote["address"])
                assert_no_overflow(page)
                print("PASS explicit removal confirmation, mobile address form and persistence across logout/login", flush=True)

                other_context = browser.new_context(viewport={"width": 390, "height": 844})
                other_member = register_member(other_context, base, PASSWORD, name="Other Local Address Member")
                assert addresses(other_context, base) == []
                checked(other_context.request.patch(base + ENDPOINT + "/" + home["id"],
                        data={**HOME, "expectedRevision": updated["revision"]}), 404)
                other_page = other_context.new_page()
                other_page.on("pageerror", lambda error: errors.append(str(error)))
                other_page.goto(base + "/account", wait_until="networkidle")
                expect(other_page.locator("article.member-address-card")).to_have_count(0)
                expect(other_page.get_by_text(remote["address"], exact=True)).to_have_count(0)
                assert_no_overflow(other_page)
                sign_out(page, base)
                sign_in(page, base, other_member["email"])
                expect(page.locator("article.member-address-card")).to_have_count(0)
                expect(page.get_by_text(remote["address"], exact=True)).to_have_count(0)
                assert addresses(context, base) == [], "Changing signed-in members must clear the former member's address state."
                for route in ("/api/config", "/api/products", "/api/members/me"):
                    response = other_context.request.get(base + route)
                    assert response.status == 200
                    assert remote["address"] not in response.text()
                staff = browser.new_context()
                checked(staff.request.post(base + "/api/auth/login", data={"identifier": "staff", "password": STAFF_PASSWORD}))
                checked(staff.request.get(base + ENDPOINT), 401)
                public = browser.new_context()
                checked(public.request.get(base + ENDPOINT), 401)
                assert errors == [], errors
                assert order_posts == [], "Address-book checks must never submit an order."
                print("PASS cross-member isolation, workforce/public exclusion, private-data boundaries and zero runtime errors or orders", flush=True)
                browser.close()
        finally:
            stop_fixture(process)


if __name__ == "__main__":
    run()
