"""Local browser check for ordinary-merchandise reports and member store credit.

Uses a temporary SQLite database with sales disabled. No production accounts,
orders, identity uploads, emails or payments are created.
"""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sqlite3
import tempfile

from playwright.sync_api import expect, sync_playwright
from membership_browser_smoke import (
    ROOT, ADMIN_PASSWORD, PASSWORD, start_fixture, stop_fixture, unused_port,
    assert_no_overflow,
)
from browser_age_helpers import register_member, workforce_sign_in

JAR = "glass-storage-jar"
TRAY = "ritual-rolling-tray"
STAFF_USER = "report.browser.clerk"
STAFF_PASS = "Local ordinary merchandise browser clerk password 42"


def seed_order(database, order_id, product_id, status, at, amount=100000):
    name = "Ordinary Glass Storage Box" if product_id == JAR else "Ordinary Desk Tray"
    item = {"id": product_id, "productId": product_id, "name": name,
            "category": "Accessories", "size": "Standard", "sizeIndex": 0,
            "price": amount, "quantity": 1}
    totals = {"subtotal": amount, "discount": 0, "delivery": 0, "total": amount}
    with sqlite3.connect(database) as db:
        db.execute("""INSERT INTO orders
            (id,created_at,updated_at,status,fulfillment,customer_json,items_json,
             totals_json,notes,promo_code,tracking_hash,request_hash)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (order_id, at, at, status, "pickup", json.dumps({"name": "Local Fixture"}),
             json.dumps([item]), json.dumps(totals), "", "", "local-only", "local-only"))


def check(response, status=200):
    assert response.status == status, response.text()
    return response.json()


def open_payment(page, order_id, member_number, redeem=None):
    card = page.locator(".processed-record").filter(has_text=order_id)
    card.get_by_role("button", name="Record merchandise payment", exact=True).click()
    dialog = page.get_by_role("dialog", name="Record merchandise payment", exact=True)
    expect(dialog).to_be_visible()
    dialog.get_by_label("Membership number", exact=True).fill(member_number)
    dialog.get_by_role("button", name="Find member", exact=True).click()
    expect(dialog.locator(".merchandise-payment-member")).to_contain_text(member_number)
    submit = dialog.get_by_role("button", name="Record paid merchandise", exact=True)
    expect(submit).to_be_disabled()
    if redeem is not None:
        dialog.get_by_label("Redeem merchandise credit (R)", exact=True).fill(redeem)
    return dialog, submit


def run():
    assert (ROOT / "dist/index.html").exists(), "Run npm run build first."
    errors, order_posts = [], []
    with tempfile.TemporaryDirectory(prefix="cana-merchandise-browser-") as directory:
        database = Path(directory) / "fixture.sqlite"
        process, base = start_fixture(database, unused_port())
        try:
            now = datetime.now(timezone.utc)
            current = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            yesterday = (now - timedelta(days=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            sast = timezone(timedelta(hours=2))
            current_day, older_day = now.astimezone(sast).date().isoformat(), (now - timedelta(days=1)).astimezone(sast).date().isoformat()
            seed_order(database, "LC-BROWSERPAID1", JAR, "ready_for_pickup", current)
            seed_order(database, "LC-BROWSERLEGACY", JAR, "completed", yesterday)
            seed_order(database, "LC-BROWSEROTHER", TRAY, "completed", current)
            seed_order(database, "LC-BROWSERREDEEM", JAR, "completed", current, amount=5000)
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                member_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                member = register_member(member_context, base, PASSWORD, name="Local Rewards Browser Member")
                member_page = member_context.new_page()
                member_page.on("pageerror", lambda error: errors.append(str(error)))
                member_page.on("request", lambda request: order_posts.append(request.url) if request.method == "POST" and "/api/orders" in request.url else None)
                member_page.goto(base + "/account", wait_until="networkidle")
                expect(member_page.get_by_role("heading", name="Merchandise rewards", exact=True)).to_be_visible()
                expect(member_page.locator(".member-rewards-balance strong")).to_have_text(re.compile(r"R\s*0[.,]00"))

                admin_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                admin = admin_context.new_page()
                admin.on("pageerror", lambda error: errors.append(str(error)))
                workforce_sign_in(admin, base, "admin", ADMIN_PASSWORD)
                check(admin_context.request.post(base + "/api/admin/staff", data={
                    "name": "Browser Merchandise Clerk", "username": STAFF_USER, "password": STAFF_PASS,
                }), 201)
                worker_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                worker = worker_context.new_page()
                worker.on("pageerror", lambda error: errors.append(str(error)))
                workforce_sign_in(worker, base, STAFF_USER, STAFF_PASS)
                expect(worker.get_by_role("tab", name="Processed reports", exact=True)).to_have_count(0)
                check(worker_context.request.get(base + "/api/admin/reports/processed-products"), 403)
                check(worker_context.request.post(base + "/api/admin/rewards/payments", data={}), 403)
                check(worker_context.request.patch(base + "/api/admin/orders/LC-BROWSERPAID1", data={
                    "status": "completed", "staffName": "Spoofed caller name",
                }))
                # Completion alone must never imply payment or award credit.
                assert check(member_context.request.get(base + "/api/members/rewards"))["rewards"]["balanceCents"] == 0
                admin.get_by_role("tab", name="Processed reports", exact=True).click()
                expect(admin.get_by_role("heading", name="Processed reports", exact=True)).to_be_visible()
                products = admin.get_by_role("group", name="Report products", exact=True)
                products.get_by_role("checkbox", name="Glass Storage Jar", exact=True).check()
                admin.get_by_role("button", name="Save report products", exact=True).click()
                expect(admin.get_by_text("Report products saved.", exact=True)).to_be_visible()
                expect(admin.locator(".processed-record")).to_have_count(3)
                expect(admin.locator(".processed-record").filter(has_text="LC-BROWSERPAID1")).to_contain_text("Browser Merchandise Clerk")
                expect(admin.locator(".processed-record").filter(has_text="LC-BROWSERPAID1")).not_to_contain_text("Spoofed caller name")
                expect(admin.locator(".processed-record").filter(has_text="LC-BROWSERLEGACY")).to_contain_text("Not recorded")
                expect(admin.locator(".processed-record").filter(has_text="LC-BROWSEROTHER")).to_have_count(0)
                expect(admin.get_by_role("region", name="Processed records for " + current_day)).to_be_visible()
                expect(admin.get_by_role("region", name="Processed records for " + older_day)).to_be_visible()
                admin.get_by_label("Report from date", exact=True).fill(current_day)
                admin.get_by_label("Report to date", exact=True).fill(current_day)
                admin.get_by_role("button", name="Apply dates", exact=True).click()
                expect(admin.locator(".processed-record")).to_have_count(2)
                expect(admin.locator(".processed-record").filter(has_text="LC-BROWSERLEGACY")).to_have_count(0)
                admin.reload(wait_until="networkidle")
                admin.get_by_role("tab", name="Processed reports", exact=True).click()
                expect(products.get_by_role("checkbox", name="Glass Storage Jar", exact=True)).to_be_checked()
                print("PASS saved product selection, SAST date groups/filtering, trusted staff attribution and historical unknown names", flush=True)

                dialog, submit = open_payment(admin, "LC-BROWSERPAID1", member["membershipNumber"])
                expect(dialog.locator(".merchandise-payment-amount strong")).to_have_text(re.compile(r"R\s*1[\s,]?000[.,]00"))
                dialog.get_by_role("checkbox", name=re.compile("^Confirm payment received")).check()
                expect(submit).to_be_enabled()
                with admin.expect_response(lambda response: response.url.endswith("/api/admin/rewards/payments") and response.request.method == "POST") as saved:
                    submit.click()
                receipt = check(saved.value)
                assert receipt["rewards"]["balanceCents"] == 1000
                expect(dialog).not_to_be_visible()
                member_page.get_by_role("button", name="Refresh rewards", exact=True).click()
                expect(member_page.locator(".member-rewards-balance strong")).to_have_text(re.compile(r"R\s*10[.,]00"))
                expect(member_page.get_by_role("list", name="Merchandise rewards history")).to_contain_text("Merchandise credit earned")
                expect(member_page.get_by_role("progressbar", name="Merchandise reward progress")).to_have_attribute("aria-valuenow", "0")
                dialog, _ = open_payment_already_recorded(admin, "LC-BROWSERPAID1")
                expect(dialog.get_by_text(re.compile("This merchandise payment has already been recorded"))).to_be_visible()
                expect(dialog.get_by_role("button", name="Record paid merchandise", exact=True)).to_have_count(0)
                dialog.get_by_role("button", name="Close merchandise payment", exact=True).click()
                print("PASS explicit paid confirmation, exact R1000→R10 credit, member history/progress and duplicate record guard", flush=True)

                dialog, submit = open_payment(admin, "LC-BROWSERREDEEM", member["membershipNumber"], redeem="10.00")
                expect(dialog.locator(".merchandise-payment-cash strong")).to_have_text(re.compile(r"R\s*40[.,]00"))
                admin.set_viewport_size({"width": 390, "height": 844})
                assert_no_overflow(admin)
                assert dialog.evaluate("el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth + 1")
                dialog.get_by_role("checkbox", name=re.compile("^Confirm payment received")).check()
                with admin.expect_response(lambda response: response.url.endswith("/api/admin/rewards/payments") and response.request.method == "POST") as redeemed:
                    submit.click()
                result = check(redeemed.value)
                assert result["receipt"]["redeemedCents"] == 1000
                assert result["receipt"]["externalPaidCents"] == 4000
                assert result["rewards"]["balanceCents"] == 0
                assert_no_overflow(admin)
                admin.screenshot(path="/tmp/cana-processed-reports-mobile.png", full_page=True)
                member_page.set_viewport_size({"width": 390, "height": 844})
                member_page.get_by_role("button", name="Refresh rewards", exact=True).click()
                expect(member_page.locator(".member-rewards-balance strong")).to_have_text(re.compile(r"R\s*0[.,]00"))
                expect(member_page.get_by_role("list", name="Merchandise rewards history")).to_contain_text("Merchandise credit used")
                expect(member_page.get_by_role("progressbar", name="Merchandise reward progress")).to_have_attribute("aria-valuenow", "4000")
                assert_no_overflow(member_page)
                member_page.locator(".member-rewards").screenshot(path="/tmp/cana-member-rewards-mobile.png")
                worker.set_viewport_size({"width": 390, "height": 844})
                assert_no_overflow(worker)
                assert errors == [], errors
                assert order_posts == [], "Browser test must never submit an order."
                print("PASS credit redemption excludes credit from new earning, mobile report/dialog/wallet layout, staff isolation and no JS errors", flush=True)
                browser.close()
        finally:
            stop_fixture(process)


def open_payment_already_recorded(page, order_id):
    page.locator(".processed-record").filter(has_text=order_id).get_by_role("button", name="Record merchandise payment", exact=True).click()
    dialog = page.get_by_role("dialog", name="Record merchandise payment", exact=True)
    expect(dialog).to_be_visible()
    return dialog, None


if __name__ == "__main__":
    run()
