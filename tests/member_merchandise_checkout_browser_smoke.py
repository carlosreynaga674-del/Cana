"""Check saved addresses and read-only EFT details without taking orders.

The isolated server keeps sales disabled. Only the browser's public config
response is adapted to show checkout. Every account, address and bank record
is synthetic; no payment, order, real identity image or email is submitted.
"""
from pathlib import Path
import json
import re
import sqlite3
import tempfile

from playwright.sync_api import expect, sync_playwright
from browser_age_helpers import register_member
from membership_browser_smoke import (
    ROOT, PASSWORD, ADMIN_PASSWORD, start_fixture, stop_fixture, unused_port,
    assert_no_overflow,
)

ADDRESS_PATH = "/api/members/addresses"
BANK_PATH = "/api/admin/merchandise-payment-details"
PRODUCT_ID = "glass-storage-jar"
PRODUCT_NAME = "Local Merchandise Storage Jar"
BANK = {
    "bankName": "Synthetic Checkout Bank", "accountHolder": "Local Merchandise Fixture",
    "accountNumber": "001234567890", "branchCode": "001234", "accountType": "business",
    "reference": "Synthetic merchandise reference",
    "instructions": "Private operator note must never appear at checkout.",
}
HOME = {"label": "Home fixture", "address": "10 Synthetic Home Street", "city": "Fixture City", "postcode": "0001"}
WORK = {"label": "Work fixture", "address": "20 Synthetic Work Avenue", "city": "Fixture City", "postcode": "0002"}
FAMILY = {"label": "Family fixture", "address": "30 Synthetic Family Road", "city": "Fixture Town", "postcode": "0003"}


def checked(response, status=200):
    assert response.status == status, response.text()
    return response.json()


def run():
    assert (ROOT / "dist/index.html").exists(), "Run npm run build first."
    errors, order_posts = [], []
    with tempfile.TemporaryDirectory(prefix="cana-merchandise-checkout-browser-") as directory:
        database = Path(directory) / "fixture.sqlite"
        process, base = start_fixture(database, unused_port())
        try:
            with sqlite3.connect(database) as db:
                row = db.execute("SELECT product_json FROM catalog_products WHERE id=?", (PRODUCT_ID,)).fetchone()
                product = json.loads(row[0])
                product["name"] = PRODUCT_NAME
                assert product["category"] == "Accessories"
                db.execute("DELETE FROM catalog_products WHERE id<>?", (PRODUCT_ID,))
                db.execute("UPDATE catalog_products SET product_json=? WHERE id=?", (json.dumps(product), PRODUCT_ID))
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                context.on("request", lambda request: order_posts.append(request.url)
                           if request.method == "POST" and "/api/orders" in request.url else None)
                member = register_member(context, base, PASSWORD, name="Local Checkout Browser Member")
                with sqlite3.connect(database) as db:
                    db.execute("UPDATE member_age_checks SET status='verified',birth_date=NULL,verified_at='2026-10-01T12:00:00.000Z',method='in_person',identity_required=0 WHERE member_id=?", (member["id"],))
                saved = {}
                for address in (HOME, WORK, FAMILY):
                    saved[address["label"]] = checked(context.request.post(base + ADDRESS_PATH, data=address), 201)["address"]
                with sqlite3.connect(database) as db:
                    for label, used in ((HOME["label"], "2026-10-01"), (WORK["label"], "2026-10-03"), (FAMILY["label"], "2026-10-02")):
                        db.execute("UPDATE member_addresses SET last_used_at=? WHERE id=?", (used + "T12:00:00.000Z", saved[label]["id"]))
                admin = browser.new_context()
                checked(admin.request.post(base + "/api/auth/login", data={"identifier": "admin", "password": ADMIN_PASSWORD}))
                private = checked(admin.request.get(base + BANK_PATH))
                checked(admin.request.put(base + BANK_PATH, data={"details": BANK, "expectedRevision": private["revision"]}))

                def checkout_config(route):
                    response = route.fetch()
                    data = response.json()
                    assert data["mode"] != "live", "The server must remain unable to accept orders."
                    data.update({"mode": "live", "deliveryZips": ["0001", "0002", "0003"], "pickupAddress": "Synthetic local fixture pickup"})
                    route.fulfill(response=response, json=data)

                context.route(base + "/api/config", checkout_config)
                context.add_init_script("localStorage.setItem('lc-location', JSON.stringify({mode:'delivery',postcode:'0001',address:''}));")
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(base + "/shop", wait_until="networkidle")
                expect(page.locator(".product-card")).to_have_count(1)
                page.get_by_role("button", name="Add " + PRODUCT_NAME + " to bag", exact=True).click()
                if page.get_by_role("dialog", name="Confirm your age").is_visible():
                    page.get_by_role("button", name="I’m 18 or older", exact=True).click()
                page.get_by_role("button", name="Open bag, 1 items").click()
                page.get_by_role("button", name="Let’s check out", exact=True).click()
                checkout = page.get_by_role("dialog", name="Checkout", exact=True)
                expect(checkout).to_be_visible()
                expect(checkout.get_by_role("heading", name="Payment details", exact=True)).to_be_visible()
                expect(checkout.locator(".checkout-payment-bank-details")).to_contain_text(BANK["accountNumber"])
                expect(checkout.locator(".checkout-payment-bank-details")).to_contain_text(BANK["branchCode"])
                expect(checkout.locator(".checkout-payment-bank-details")).to_contain_text(BANK["reference"])
                expect(checkout.get_by_text(BANK["instructions"], exact=True)).to_have_count(0)
                expect(checkout.get_by_label("Saved delivery address", exact=True)).to_have_value(saved[WORK["label"]]["id"])
                for field, value in (("Street address", WORK["address"]), ("City", WORK["city"]), ("Postal code", WORK["postcode"])):
                    expect(checkout.get_by_label(field, exact=True)).to_have_value(value)
                print("PASS eligible merchandise checkout shows live admin EFT details, hides private notes and prefills the most recently used address", flush=True)

                checkout.get_by_label("Saved delivery address", exact=True).select_option(saved[HOME["label"]]["id"])
                expect(checkout.get_by_label("Street address", exact=True)).to_have_value(HOME["address"])
                expect(checkout.get_by_label("Postal code", exact=True)).to_have_value("0001")
                submit = checkout.get_by_role("button", name=re.compile("^Submit order request"))
                expect(submit).to_be_enabled()
                checkout.get_by_label("Street address", exact=True).fill("40 Unsaved Fourth Fixture Street")
                expect(submit).to_be_disabled()
                expect(checkout.get_by_text(re.compile("three saved slots are full"))).to_be_visible()
                expect(checkout.get_by_role("button", name="Manage saved addresses", exact=True)).to_be_visible()
                checkout.get_by_label("Saved delivery address", exact=True).select_option(saved[WORK["label"]]["id"])
                expect(submit).to_be_enabled()
                print("PASS saved address selection, editable fields and full three-address cap prevent a silent fourth-address overwrite", flush=True)

                latest = checked(admin.request.get(base + BANK_PATH))
                changed = {**BANK, "bankName": "Updated Synthetic Checkout Bank"}
                checked(admin.request.put(base + BANK_PATH, data={"details": changed, "expectedRevision": latest["revision"]}))
                checkout.get_by_role("button", name="Refresh payment details", exact=True).click()
                expect(checkout.locator(".checkout-payment-bank-details")).to_contain_text(changed["bankName"])
                page.set_viewport_size({"width": 390, "height": 844})
                assert_no_overflow(page)
                assert checkout.evaluate("el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth + 1")
                checkout.locator(".checkout-content").screenshot(path="/tmp/cana-merchandise-checkout-mobile.png")
                actual_config = checked(context.request.get(base + "/api/config"))
                assert actual_config["mode"] != "live"
                with sqlite3.connect(database) as db:
                    assert db.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 0
                assert order_posts == [], "This checkout check must never submit an order."
                assert errors == [], errors
                print("PASS refreshed bank details and mobile checkout layout with zero JavaScript errors, transfers or orders; server sales remain disabled", flush=True)
                browser.close()
        finally:
            stop_fixture(process)


if __name__ == "__main__":
    run()
