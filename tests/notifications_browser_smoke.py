"""Exercise private account notifications on an isolated local member fixture.

Run after ``npm run build``. This suite uses synthetic ID images, temporary
SQLite storage and loopback HTTP only. It does not send mail or create orders.
"""
import base64
from pathlib import Path
import re
import tempfile
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

from browser_age_helpers import (
    register_member,
    synthetic_identity_images,
    workforce_sign_in,
)
from membership_browser_smoke import (
    ADMIN_PASSWORD,
    assert_no_overflow,
    start_fixture,
    stop_fixture,
    unused_port,
)


def feed(context, base):
    response = context.request.get(base + "/api/admin/notifications")
    assert response.status == 200, response.text()
    result = response.json()
    assert isinstance(result.get("notifications"), list), result
    return result


def refresh_on_focus(page):
    page.bring_to_front()
    page.evaluate("window.dispatchEvent(new Event('focus'))")


def expect_unread(page, count):
    expect(page.get_by_role(
        "button", name=f"Notifications, {count} unread", exact=True,
    )).to_be_visible(timeout=20000)


def open_notifications(page):
    page.get_by_role("button", name=re.compile(r"^Notifications, \d+ unread$")).click()
    expect(page.get_by_role("heading", name="Your team inbox.", exact=True)).to_be_visible()


def rows(page):
    return page.get_by_role("list", name="Account notifications").get_by_role("listitem")


def run():
    errors, forbidden_writes = [], []
    email = f"notifications-browser-{uuid4().hex}@example.test"
    name = "Local Notification Applicant"
    updated_name = "Updated Local Notification Applicant"
    worker_username = "notifications.reviewer"
    worker_password = "Local notification browser reviewer password 42"

    def watch(context):
        context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
        context.on("request", lambda request: forbidden_writes.append(request.url)
                   if request.method not in ("GET", "HEAD", "OPTIONS") and
                   re.search(r"/api/(?:admin/)?orders(?:/|$)", request.url) else None)

    with tempfile.TemporaryDirectory(prefix="cana-notifications-browser-") as directory:
        process, base = start_fixture(Path(directory) / "notifications.sqlite", unused_port())
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"],
                )
                admin_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                watch(admin_context)
                admin = admin_context.new_page()
                workforce_sign_in(admin, base, "admin", ADMIN_PASSWORD)
                expect_unread(admin, 0)

                created = admin_context.request.post(base + "/api/admin/staff", data={
                    "name": "Local Notification Reviewer", "username": worker_username,
                    "password": worker_password,
                })
                assert created.status == 201, created.text()
                employee = created.json()["staff"]
                worker_context = browser.new_context(viewport={"width": 390, "height": 844})
                watch(worker_context)
                worker = worker_context.new_page()
                workforce_sign_in(worker, base, worker_username, worker_password)
                expect_unread(worker, 0)

                customer = browser.new_context()
                watch(customer)
                assert customer.request.get(base + "/api/admin/notifications").status == 401
                member = register_member(
                    customer, base, "Local notification applicant password 84", name=name, email=email,
                )
                assert customer.request.get(base + "/api/admin/notifications").status == 401
                for page in (admin, worker):
                    refresh_on_focus(page)
                    expect_unread(page, 1)
                print("PASS new signup reaches both authenticated dashboards; public/member notification access is denied", flush=True)

                open_notifications(admin)
                application = rows(admin).filter(has_text=name)
                expect(application).to_have_count(1)
                application.get_by_role("button", name="Mark as read", exact=True).click()
                expect_unread(admin, 0)
                expect_unread(worker, 1)
                assert feed(admin_context, base)["notifications"][0]["readAt"]
                assert feed(worker_context, base)["notifications"][0]["readAt"] is None
                application.get_by_role("button", name="Open member", exact=True).click()
                expect(admin.get_by_role("tab", name="Members", exact=True)).to_have_attribute("aria-selected", "true")
                expect(admin.get_by_role("list", name="Registered members")).to_contain_text(name)
                admin.reload(wait_until="networkidle")
                expect_unread(admin, 0)

                open_notifications(worker)
                worker.get_by_role("button", name="Mark all read", exact=True).click()
                expect_unread(worker, 0)
                worker.reload(wait_until="networkidle")
                expect_unread(worker, 0)
                open_notifications(worker)
                worker.get_by_role("group", name="Filter notifications").get_by_role("button", name="Unread", exact=True).click()
                expect(rows(worker)).to_have_count(0)
                worker.get_by_role("group", name="Filter notifications").get_by_role("button", name="All activity", exact=True).click()
                expect(rows(worker)).to_have_count(1)
                assert_no_overflow(worker)
                print("PASS per-person read state, member links, unread filtering and persistence after browser reload", flush=True)

                images = synthetic_identity_images()
                upload = customer.request.post(base + "/api/members/identity-verification", data={
                    "identityConsent": True,
                    **{key: {"data": base64.b64encode(content).decode()} for key, content in images.items()},
                })
                assert upload.status == 200, upload.text()
                verification = upload.json()["verification"]
                for page in (admin, worker):
                    refresh_on_focus(page)
                    expect_unread(page, 1)
                open_notifications(worker)
                requested = next(item for item in feed(worker_context, base)["notifications"]
                                 if item["type"] == "verification_requested")
                verification_row = rows(worker).filter(has_text=requested["title"]).filter(has_text=name)
                expect(verification_row).to_have_count(1)
                worker.screenshot(path="/tmp/cana-notifications-mobile.png", full_page=True)
                assert_no_overflow(worker)
                verification_row.get_by_role("button", name="Open application", exact=True).click()
                expect(worker.get_by_role("tab", name="Age checks", exact=True)).to_have_attribute("aria-selected", "true")
                expect(worker.locator(".staff-age-card").filter(has_text=email)).to_be_visible()
                print("PASS ID/selfie request notification links to its private review and fits a 390px viewport", flush=True)

                reviewed = admin_context.request.post(
                    base + f"/api/admin/members/{member['id']}/age-verification", data={
                        "decision": "rejected", "reason": "unable_to_verify", "method": "uploaded_id_selfie",
                        "expectedUploadId": verification["uploadId"],
                        "expectedSubmittedAt": member["ageVerification"]["submittedAt"],
                    },
                )
                assert reviewed.status == 200, reviewed.text()
                updated = customer.request.patch(base + "/api/members/me", data={"name": updated_name})
                assert updated.status == 200, updated.text()
                for page in (admin, worker):
                    refresh_on_focus(page)
                open_notifications(worker)
                worker.get_by_role("button", name="Refresh notifications", exact=True).click()
                expect(rows(worker)).to_have_count(4)
                current_feed = feed(worker_context, base)
                assert {item["type"] for item in current_feed["notifications"]} == {
                    "member_registered", "verification_requested", "verification_reviewed", "member_profile_updated",
                }
                expect(worker.get_by_role("list", name="Account notifications")).to_contain_text(updated_name)
                worker.get_by_role("button", name="Mark all read", exact=True).click()
                expect_unread(worker, 0)
                assert feed(admin_context, base)["unreadCount"] == 3
                worker.reload(wait_until="networkidle")
                expect_unread(worker, 0)
                open_notifications(worker)
                expect(rows(worker)).to_have_count(4)
                assert_no_overflow(worker)
                review_notice = next(item for item in feed(worker_context, base)["notifications"]
                                     if item["type"] == "verification_reviewed")
                rows(worker).filter(has_text=review_notice["title"]).get_by_role(
                    "button", name="Open application", exact=True,
                ).click()
                current_application = worker.locator(".staff-age-card").filter(has_text=email)
                expect(current_application).to_be_visible()
                expect(current_application).to_contain_text(updated_name)
                expect(worker.get_by_role("group", name="Filter age checks").get_by_role(
                    "button", name="Submission needed", exact=True,
                )).to_have_attribute("aria-pressed", "true")
                open_notifications(worker)
                expect(rows(worker)).to_have_count(4)
                print("PASS review outcomes and genuine profile updates appear without sharing another user's read receipts", flush=True)

                disabled = admin_context.request.patch(base + f"/api/admin/staff/{employee['id']}", data={
                    "revision": employee["revision"], "active": False,
                })
                assert disabled.status == 200, disabled.text()
                assert worker_context.request.get(base + "/api/admin/notifications").status == 401
                refresh_on_focus(worker)
                expect(worker.get_by_role("list", name="Account notifications")).to_have_count(0, timeout=20000)
                expect(worker.get_by_role("button", name=re.compile(r"^Notifications, \d+ unread$"))).to_have_count(0)
                assert feed(admin_context, base)["unreadCount"] == 3
                assert_no_overflow(worker)
                print("PASS disabled staff lose the private notification feed while administrator access remains", flush=True)
                browser.close()
        finally:
            stop_fixture(process)
    assert not errors, errors
    assert not forbidden_writes, forbidden_writes
    print("PASS zero uncaught browser errors, mail sends or order submissions", flush=True)


if __name__ == "__main__":
    run()
