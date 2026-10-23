"""Check staff management and public catalog integration on an isolated local DB."""
from pathlib import Path
import tempfile
import base64
import re
from uuid import uuid4

from playwright.sync_api import sync_playwright, expect
from membership_browser_smoke import start_fixture, stop_fixture, unused_port, assert_no_overflow, ADMIN_PASSWORD, STAFF_PASSWORD
from browser_age_helpers import register_member, synthetic_identity_images, workforce_sign_in


def run():
    errors = []
    name = "Local Browser Published Grinder"
    email = f"directory-browser-{uuid4().hex}@example.test"
    with tempfile.TemporaryDirectory(prefix="cana-management-browser-") as directory:
        database = Path(directory) / "management.sqlite"
        process, base = start_fixture(database, unused_port())
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                customer = browser.new_context(viewport={"width": 1440, "height": 1000})
                member = register_member(customer, base, "Local directory browser account password", name="Browser Directory Member", email=email)
                images = synthetic_identity_images()
                uploaded = customer.request.post(base + "/api/members/identity-verification", data={
                    "identityConsent": True,
                    **{key: {"data": base64.b64encode(content).decode()} for key, content in images.items()},
                })
                assert uploaded.status == 200, uploaded.text()
                public = customer.new_page()
                public.on("pageerror", lambda error: errors.append(str(error)))
                customer.request.post(base + "/api/members/logout")
                public.goto(base + "/login", wait_until="networkidle")
                public.get_by_label("Email or staff username", exact=True).fill(email)
                public.get_by_label("Password", exact=True).fill("Local directory browser account password")
                public.get_by_role("button", name="Sign in", exact=True).click()
                expect(public).to_have_url(base + "/account")
                public.goto(base + "/shop", wait_until="networkidle")
                public.get_by_label("Search products", exact=True).fill(name)
                expect(public.locator(".product-card")).to_have_count(0)
                assert public.request.get(base + "/api/admin/members").status == 401
                assert public.request.get(base + "/api/admin/products").status == 401

                staff_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                staff = staff_context.new_page()
                staff.on("pageerror", lambda error: errors.append(str(error)))
                staff.goto(base + "/staff", wait_until="networkidle")
                expect(staff.get_by_role("tab", name="Members", exact=True)).to_have_count(0)
                workforce_sign_in(staff, base, "admin", ADMIN_PASSWORD)
                expect(staff.get_by_role("tab", name="Overview", exact=True)).to_be_visible()
                assert staff.request.get(base + "/api/admin/overview").status == 200
                staff.screenshot(path="/tmp/cana-admin-overview-desktop.png", full_page=True)
                staff.get_by_role("tab", name="Members", exact=True).click()
                staff.get_by_label("Search registered members", exact=True).fill(email)
                records = staff.get_by_role("list", name="Registered members").get_by_role("listitem")
                expect(records).to_have_count(1)
                expect(records.first).to_contain_text("Browser Directory Member")
                expect(records.first).to_contain_text("ID + selfie needed")
                staff.set_viewport_size({"width": 390, "height": 844})
                assert_no_overflow(staff)
                staff.screenshot(path="/tmp/cana-staff-member-directory-mobile.png", full_page=True)
                print("PASS private registered-member directory, name/email search, identity-review status and mobile layout", flush=True)

                staff.get_by_role("tab", name="Age checks", exact=True).click()
                card = staff.locator(".staff-age-card").filter(has_text=email)
                card.locator(".staff-age-summary").click()
                image_panel = staff.get_by_role("region", name="Private ID document and selfie")
                expect(image_panel.locator("img")).to_have_count(2)
                for image in image_panel.locator("img").all():
                    expect(image).to_be_visible()
                    assert image.evaluate("image => image.complete && image.naturalWidth >= 200")
                identity_checkbox = staff.get_by_role("checkbox", name=re.compile("^I reviewed the uploaded ID document"))
                expect(identity_checkbox).to_be_enabled()
                staff.screenshot(path="/tmp/cana-private-id-selfie-review-mobile.png", full_page=True)
                identity_checkbox.check()
                staff.get_by_role("checkbox", name="The date of birth visible on the uploaded ID shows that this applicant is 18 years or older today.", exact=True).check()
                staff.get_by_role("button", name="Record ID + selfie check", exact=True).click()
                with staff.expect_response(lambda response: response.url.endswith(f"/api/admin/members/{member['id']}/age-verification") and response.request.method == "POST") as reviewed:
                    staff.get_by_role("region", name="Confirm age check decision").get_by_role("button", name="Confirm manual ID + selfie check", exact=True).click()
                assert reviewed.value.status == 200, reviewed.value.text()
                assert reviewed.value.json()["member"]["ageVerification"]["status"] == "verified"
                assert customer.request.get(base + f"/api/admin/members/{member['id']}/identity-documents/document").status == 401
                assert staff.request.get(base + f"/api/admin/members/{member['id']}/identity-documents/document").status == 404
                assert_no_overflow(staff)
                print("PASS private ID/selfie preview, explicit manual reviewer attestations, actual review and image removal", flush=True)

                staff.get_by_role("tab", name="Products", exact=True).click()
                staff.get_by_role("button", name="Add product", exact=True).click()
                staff.get_by_label("Product name", exact=True).fill(name)
                staff.get_by_label("Category", exact=True).select_option("Accessories")
                staff.get_by_label("Price (ZAR)", exact=True).fill("180.50")
                staff.get_by_label("Size or pack", exact=True).fill("One grinder")
                staff.locator('textarea[name="description"]').fill("A local automated browser fixture, never a production product.")
                assert_no_overflow(staff)
                staff.screenshot(path="/tmp/cana-staff-product-editor-mobile.png", full_page=True)
                with staff.expect_response(lambda response: response.url == base + "/api/admin/products" and response.request.method == "POST") as saved:
                    staff.get_by_role("button", name="Save draft", exact=True).click()
                assert saved.value.status == 201, saved.value.text()
                product = saved.value.json()["product"]
                staff.get_by_label("Search staff products", exact=True).fill(name)
                row = staff.get_by_role("list", name="Managed products").get_by_role("listitem").filter(has_text=name)
                expect(row).to_contain_text("Draft")
                assert_no_overflow(staff)
                public.reload(wait_until="networkidle")
                public.get_by_label("Search products", exact=True).fill(name)
                expect(public.locator(".product-card")).to_have_count(0)
                staff.get_by_role("button", name=f"Publish {name}", exact=True).click()
                with staff.expect_response(lambda response: response.url.endswith("/api/admin/products/" + product["id"]) and response.request.method == "PATCH") as published:
                    staff.get_by_role("region", name="Confirm product status").get_by_role("button", name="Confirm publish", exact=True).click()
                assert published.value.status == 200, published.value.text()
                public.reload(wait_until="networkidle")
                public.get_by_label("Search products", exact=True).fill(name)
                expect(public.locator(".product-card")).to_have_count(1)
                expect(public.locator(".product-card")).to_contain_text(re.compile(r"R\s*180[.,]50"))
                staff.screenshot(path="/tmp/cana-staff-products-mobile.png", full_page=True)
                print("PASS staff draft creation, publication confirmation and immediate public storefront publication", flush=True)

                staff.get_by_role("button", name=f"Edit {name}", exact=True).click()
                staff.get_by_label("Price (ZAR)", exact=True).fill("199.00")
                with staff.expect_response(lambda response: response.url.endswith("/api/admin/products/" + product["id"]) and response.request.method == "PATCH") as edited:
                    staff.get_by_role("button", name="Save product changes", exact=True).click()
                assert edited.value.status == 200, edited.value.text()
                public.reload(wait_until="networkidle")
                public.get_by_label("Search products", exact=True).fill(name)
                expect(public.locator(".product-card")).to_contain_text(re.compile(r"R\s*199[.,]00"))
                staff.get_by_role("button", name=f"Archive {name}", exact=True).click()
                with staff.expect_response(lambda response: response.url.endswith("/api/admin/products/" + product["id"]) and response.request.method == "PATCH") as archived:
                    staff.get_by_role("region", name="Confirm product status").get_by_role("button", name="Confirm archive", exact=True).click()
                assert archived.value.status == 200, archived.value.text()
                public.reload(wait_until="networkidle")
                public.get_by_label("Search products", exact=True).fill(name)
                expect(public.locator(".product-card")).to_have_count(0)
                assert_no_overflow(staff)
                print("PASS staff price edit, archive confirmation and removal from current storefront", flush=True)

                worker_context = browser.new_context(viewport={"width": 390, "height": 844})
                worker = worker_context.new_page()
                worker.on("pageerror", lambda error: errors.append(str(error)))
                workforce_sign_in(worker, base, "staff", STAFF_PASSWORD)
                expect(worker.get_by_role("tab", name="Overview", exact=True)).to_have_count(0)
                expect(worker.get_by_role("tab", name="Order requests", exact=True)).to_be_visible()
                worker.screenshot(path="/tmp/cana-staff-workspace-mobile.png", full_page=True)
                assert worker.request.get(base + "/api/admin/overview").status == 403
                worker.goto(base + "/admin", wait_until="networkidle")
                expect(worker.get_by_role("heading", name="Admin access required.", exact=True)).to_be_visible()
                assert_no_overflow(worker)
                print("PASS one login page sends member/admin/staff to separate dashboards and enforces admin-only overview", flush=True)
                browser.close()
                assert not errors, errors
                print("PASS zero uncaught browser errors", flush=True)
        finally:
            stop_fixture(process)


if __name__ == "__main__":
    run()
