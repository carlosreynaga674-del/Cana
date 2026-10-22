"""Actual browser-to-server integration for the built Loud + Cana app.

Run `npm run build`, then `python3 tests/live_browser_smoke.py`.
Requires Python Playwright and /usr/bin/chromium in this cloud environment.
All authorization, customer, and store data below are fictitious test fixtures.
The fixture binds only to loopback and uses a temporary SQLite database.
No deployment configuration or real orders are changed.
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

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TEST_PASSWORD = "local-test-password-for-api-only"


def unused_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def start_fixture(database_path, port):
    process = subprocess.Popen(
        ["node", "tests/fixtures/live-server.mjs"],
        cwd=ROOT,
        env={**os.environ, "LC_RUN_TEST_FIXTURE": "1", "LC_TEST_DATABASE_PATH": str(database_path), "LC_TEST_PORT": str(port)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if process.poll() is not None:
            raise AssertionError(f"Local test server failed: {process.stderr.read()}")
        try:
            with urllib.request.urlopen(base + "/api/config", timeout=.5) as response:
                config = json.load(response)
                assert config["mode"] == "live", config
                return process, base
        except OSError:
            time.sleep(.05)
    process.terminate()
    raise AssertionError("Local test server did not become ready.")


def stop_fixture(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def run():
    assert (ROOT / "dist/index.html").exists(), "Run npm run build first."
    browser_errors = []
    with tempfile.TemporaryDirectory(prefix="loud-cana-browser-test-") as directory:
        database = Path(directory) / "orders.sqlite"
        port = unused_port()
        process, base = start_fixture(database, port)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                customer_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                page = customer_context.new_page()
                page.on("pageerror", lambda error: browser_errors.append(str(error)))
                page.goto(base, wait_until="networkidle")
                expect(page.locator(".product-card")).to_have_count(8)
                page.get_by_role("button", name="Add Sunset Sherbet to bag", exact=True).click()
                page.get_by_role("button", name="I’m 21 or older", exact=True).click()
                page.get_by_role("button", name="Open bag, 1 items").click()
                page.get_by_label("Promo code").fill("LOUD15")
                page.get_by_role("button", name="Apply", exact=True).click()
                page.get_by_role("button", name="Let’s check out").click()
                page.get_by_label("Full name", exact=True).fill("Jordan Browser Test")
                page.get_by_label("Email address", exact=True).fill("jordan@example.com")
                page.get_by_label("Phone number", exact=True).fill("0712345678")
                page.get_by_label("Street address", exact=True).fill("123 Test Fixture Lane")
                page.get_by_label("City", exact=True).fill("Johannesburg")
                page.get_by_label("Postal code", exact=True).fill("2196")
                page.get_by_label("Delivery notes").fill("Browser test only. Please ring the bell.")
                page.get_by_role("checkbox").check()
                with page.expect_response(lambda response: response.url == base + "/api/orders" and response.request.method == "POST") as response_info:
                    page.get_by_role("button", name=re.compile("Submit order request")).click()
                response = response_info.value
                assert response.status == 201, response.text()
                result = response.json()
                order_id = result["order"]["id"]
                token = result["trackingToken"]
                assert result["order"]["status"] == "pending"
                assert result["order"]["notes"] == "Browser test only. Please ring the bell."
                assert result["order"]["totals"]["discount"] > 0
                expect(page.get_by_role("dialog", name="Order confirmation")).to_be_visible()
                private_link = page.get_by_label("Private tracking link", exact=True).input_value()
                assert order_id in private_link and "#track=" in private_link
                assert token in private_link
                expect(page.locator(".order-timeline .complete")).to_have_count(1)
                print("PASS actual storefront POST, authoritative pricing/discount, pending request, notes, private tracking token", flush=True)

                staff_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                staff = staff_context.new_page()
                staff.on("pageerror", lambda error: browser_errors.append(str(error)))
                staff.goto(base + "/staff", wait_until="networkidle")
                expect(staff.get_by_role("heading", name="Good to see you.")).to_be_visible()
                staff.get_by_label("Staff password").fill(TEST_PASSWORD)
                staff.get_by_role("button", name="Let’s get to the good").click()
                expect(staff.get_by_role("heading", name="Every request. A little care.")).to_be_visible()
                expect(staff.locator(".staff-service-badge")).to_have_text("Live intake enabled")
                staff.locator(".staff-order-summary").filter(has_text=order_id).click()
                expect(staff.get_by_text("Browser test only. Please ring the bell.")).to_be_visible()
                for status, action in [("confirmed", "Confirm request"), ("preparing", "Start preparing"), ("out_for_delivery", "Mark out for delivery"), ("delivered", "Mark delivered")]:
                    staff.get_by_role("button", name=action, exact=True).click()
                    if status == "confirmed":
                        expect(staff.get_by_role("button", name="Confirm update", exact=True)).to_be_disabled()
                        staff.get_by_role("checkbox").check()
                    with staff.expect_response(lambda response: response.url == base + "/api/admin/orders/" + order_id and response.request.method == "PATCH") as update_info:
                        staff.get_by_role("button", name="Confirm update", exact=True).click()
                    update = update_info.value
                    assert update.status == 200, update.text()
                    assert update.json()["order"]["status"] == status
                expect(staff.locator(".staff-order-summary .staff-status")).to_have_text("Delivered")
                staff.screenshot(path="/tmp/loud-cana-staff-dashboard.png", full_page=True)
                staff.set_viewport_size({"width": 390, "height": 844})
                assert not staff.evaluate("document.documentElement.scrollWidth > innerWidth"), "Staff mobile overflow"
                staff.screenshot(path="/tmp/loud-cana-staff-mobile.png", full_page=True)
                print("PASS real staff session, request review, delivery status transitions, notes, mobile layout", flush=True)

                page.get_by_role("button", name="Refresh order status", exact=True).click()
                expect(page.locator(".order-timeline .complete")).to_have_count(5)
                fresh_context = browser.new_context(viewport={"width": 390, "height": 844})
                fresh = fresh_context.new_page()
                fresh.on("pageerror", lambda error: browser_errors.append(str(error)))
                fresh.goto(private_link, wait_until="networkidle")
                expect(fresh.get_by_role("dialog", name="Track your order")).to_be_visible()
                expect(fresh.locator(".order-number strong")).to_have_text(order_id)
                expect(fresh.locator(".order-timeline .complete")).to_have_count(5)
                forbidden = fresh.request.get(base + "/api/orders/" + order_id)
                assert forbidden.status in (401, 404)
                print("PASS customer status refresh, private tracking in a new browser, unauthorized tracking denied", flush=True)

                # The tracking token must remain usable after the process restarts.
                stop_fixture(process)
                process, _ = start_fixture(database, port)
                fresh.goto(private_link, wait_until="networkidle")
                expect(fresh.locator(".order-number strong")).to_have_text(order_id)
                expect(fresh.locator(".order-timeline .complete")).to_have_count(5)
                assert database.stat().st_size > 0
                print("PASS SQLite request/status/token persistence across server restart", flush=True)
                fresh_context.close()
                staff_context.close()
                customer_context.close()
                browser.close()
                assert not browser_errors, browser_errors
                print("PASS no uncaught browser errors", flush=True)
        finally:
            stop_fixture(process)


if __name__ == "__main__":
    run()
