"""Check staff management and public catalog integration on an isolated local DB."""
from pathlib import Path
import tempfile
import base64
import re
from uuid import uuid4

from playwright.sync_api import sync_playwright, expect
from membership_browser_smoke import start_fixture, stop_fixture, unused_port, assert_no_overflow, ADMIN_PASSWORD
from browser_age_helpers import register_member, synthetic_identity_images, workforce_sign_in


def run():
    errors = []
    name = "Local Browser Published Grinder"
    email = f"directory-browser-{uuid4().hex}@example.test"
    employee_username = "review.employee"
    employee_password = "Local browser employee review password 42"
    replacement_password = "Local browser employee replacement password 84"
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
                expect(public.get_by_role("link", name=re.compile("Staff access", re.I))).to_have_count(0)
                public.get_by_label("Email or username", exact=True).fill(email)
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
                staff.get_by_role("tab", name="Staff accounts", exact=True).click()
                staff.get_by_role("button", name="Create staff account", exact=True).click()
                staff.get_by_label("Staff member name", exact=True).fill("Local Review Employee")
                staff.get_by_label("Staff username", exact=True).fill(employee_username)
                staff.get_by_label("Staff password", exact=True).fill(employee_password)
                staff.get_by_label("Confirm staff password", exact=True).fill(employee_password)
                with staff.expect_response(lambda response: response.url == base + "/api/admin/staff" and response.request.method == "POST") as created_staff:
                    staff.get_by_role("button", name="Create account", exact=True).click()
                assert created_staff.value.status == 201, created_staff.value.text()
                employee = created_staff.value.json()["staff"]
                employee_row = staff.get_by_role("list", name="Staff accounts").get_by_role("listitem").filter(has_text=employee_username)
                expect(employee_row).to_contain_text("Local Review Employee")
                worker_context = browser.new_context(viewport={"width": 390, "height": 844})
                worker = worker_context.new_page()
                worker.on("pageerror", lambda error: errors.append(str(error)))
                workforce_sign_in(worker, base, employee_username, employee_password)
                expect(worker.get_by_role("tab", name="Staff accounts", exact=True)).to_have_count(0)
                assert worker.request.get(base + "/api/admin/staff").status == 403
                print("PASS administrator creates an individual staff account and only that assigned login reaches its staff dashboard", flush=True)
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

                worker.get_by_role("tab", name="Age checks", exact=True).click()
                card = worker.locator(".staff-age-card").filter(has_text=email)
                card.locator(".staff-age-summary").click()
                image_panel = worker.get_by_role("region", name="Private ID document and selfie")
                expect(image_panel.locator("img")).to_have_count(2)
                for image in image_panel.locator("img").all():
                    expect(image).to_be_visible()
                    assert image.evaluate("image => image.complete && image.naturalWidth >= 200")
                identity_checkbox = worker.get_by_role("checkbox", name=re.compile("^I reviewed the uploaded ID document"))
                expect(identity_checkbox).to_be_enabled()
                worker.screenshot(path="/tmp/cana-private-id-selfie-review-mobile.png", full_page=True)
                identity_checkbox.check()
                worker.get_by_role("checkbox", name="The date of birth visible on the uploaded ID shows that this applicant is 18 years or older today.", exact=True).check()
                worker.get_by_role("button", name="Record ID + selfie check", exact=True).click()
                with worker.expect_response(lambda response: response.url.endswith(f"/api/admin/members/{member['id']}/age-verification") and response.request.method == "POST") as reviewed:
                    worker.get_by_role("region", name="Confirm age check decision").get_by_role("button", name="Confirm manual ID + selfie check", exact=True).click()
                assert reviewed.value.status == 200, reviewed.value.text()
                assert reviewed.value.json()["member"]["ageVerification"]["status"] == "verified"
                assert customer.request.get(base + f"/api/admin/members/{member['id']}/identity-documents/document").status == 401
                assert worker.request.get(base + f"/api/admin/members/{member['id']}/identity-documents/document").status == 404
                assert_no_overflow(worker)
                print("PASS individual staff private ID/selfie preview, explicit manual attestations, application approval and image removal", flush=True)

                staff.get_by_role("tab", name="Products", exact=True).click()
                staff.get_by_role("button", name="Add product", exact=True).click()
                staff.get_by_label("Product name", exact=True).fill(name)
                staff.get_by_label("Category", exact=True).select_option("Accessories")
                staff.get_by_label("Price (ZAR)", exact=True).fill("180.50")
                staff.get_by_label("Size or pack", exact=True).fill("One grinder")
                staff.locator('textarea[name="description"]').fill("A local automated browser fixture, never a production product.")
                staff.get_by_label("Choose product photo", exact=True).set_input_files({
                    "name": "local-synthetic-product-photo.png", "mimeType": "image/png", "buffer": images["document"],
                })
                selected_photo = staff.get_by_alt_text("Selected product photo", exact=True)
                expect(selected_photo).to_be_visible()
                assert selected_photo.evaluate("async image => { await image.decode(); return image.naturalWidth >= 200; }")
                expect(staff.get_by_role("button", name="Save draft", exact=True)).to_be_disabled()
                with staff.expect_response(lambda response: response.url == base + "/api/admin/product-images" and response.request.method == "POST") as uploaded_photo:
                    staff.get_by_role("button", name="Upload photo", exact=True).click()
                assert uploaded_photo.value.status == 201, uploaded_photo.value.text()
                media = uploaded_photo.value.json()["image"]
                preview = staff.get_by_alt_text("Product photo preview", exact=True)
                expect(preview).to_be_visible()
                assert preview.evaluate("async image => { await image.decode(); return image.naturalWidth > 0; }")
                assert customer.request.get(base + media["url"]).status == 404, "Draft photos must not be public."
                assert_no_overflow(staff)
                staff.screenshot(path="/tmp/cana-staff-product-editor-mobile.png", full_page=True)
                with staff.expect_response(lambda response: response.url == base + "/api/admin/products" and response.request.method == "POST") as saved:
                    staff.get_by_role("button", name="Save draft", exact=True).click()
                assert saved.value.status == 201, saved.value.text()
                product = saved.value.json()["product"]
                assert product["imageUrl"] == media["url"]
                staff.get_by_label("Search staff products", exact=True).fill(name)
                row = staff.get_by_role("list", name="Managed products").get_by_role("listitem").filter(has_text=name)
                expect(row).to_contain_text("Draft")
                assert row.locator("img").first.evaluate("async image => { await image.decode(); return image.naturalWidth > 0; }"), "Staff must be able to preview a draft's private uploaded photo."
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
                product_photo = public.locator(".product-card img").first
                expect(product_photo).to_have_attribute("src", media["url"])
                assert product_photo.evaluate("async image => { await image.decode(); return image.naturalWidth > 0; }")
                staff.screenshot(path="/tmp/cana-staff-products-mobile.png", full_page=True)
                print("PASS direct product-photo selection/upload, private draft preview and published storefront photo", flush=True)

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
                assert customer.request.get(base + media["url"]).status == 404, "Archived product photos must not stay publicly accessible."
                assert_no_overflow(staff)
                print("PASS staff price edit, archive confirmation and removal from current storefront", flush=True)

                worker.get_by_role("tab", name="Members", exact=True).click()
                worker.get_by_label("Search registered members", exact=True).fill(email)
                expect(worker.get_by_role("list", name="Registered members").get_by_role("listitem")).to_have_count(1)
                expect(worker.get_by_role("button", name=re.compile(r"^Delete member"))).to_have_count(0)
                assert worker.request.delete(base + f"/api/admin/members/{member['id']}", data={"confirmEmail": email, "expectedUpdatedAt": "stale"}).status == 403

                worker.get_by_role("tab", name="Order requests", exact=True).click()
                expect(worker.get_by_role("tab", name="Overview", exact=True)).to_have_count(0)
                expect(worker.get_by_role("tab", name="Order requests", exact=True)).to_be_visible()
                worker.screenshot(path="/tmp/cana-staff-workspace-mobile.png", full_page=True)
                assert worker.request.get(base + "/api/admin/overview").status == 403
                worker.goto(base + "/admin", wait_until="networkidle")
                expect(worker.get_by_role("heading", name="Admin access required.", exact=True)).to_be_visible()
                assert_no_overflow(worker)
                print("PASS one login page sends member/admin/staff to separate dashboards and enforces admin-only overview", flush=True)

                staff.get_by_role("tab", name="Staff accounts", exact=True).click()
                employee_row = staff.get_by_role("list", name="Staff accounts").get_by_role("listitem").filter(has_text=employee_username)
                employee_row.get_by_role("button", name="Reset password", exact=True).click()
                staff.get_by_label("New staff password", exact=True).fill(replacement_password)
                staff.get_by_label("Confirm new staff password", exact=True).fill(replacement_password)
                staff.get_by_role("button", name="Review password reset", exact=True).click()
                with staff.expect_response(lambda response: response.url.endswith("/api/admin/staff/" + employee["id"]) and response.request.method == "PATCH") as reset:
                    staff.get_by_role("region", name="Confirm staff password reset").get_by_role("button", name="Reset password and end sessions", exact=True).click()
                assert reset.value.status == 200, reset.value.text()
                assert worker.request.get(base + "/api/admin/members").status == 401
                assert worker.request.post(base + "/api/auth/login", data={"identifier": employee_username, "password": employee_password}).status == 401
                workforce_sign_in(worker, base, employee_username, replacement_password)
                employee_row.get_by_role("button", name="Disable access", exact=True).click()
                with staff.expect_response(lambda response: response.url.endswith("/api/admin/staff/" + employee["id"]) and response.request.method == "PATCH") as disabled:
                    staff.get_by_role("region", name="Confirm staff access change").get_by_role("button", name="Disable access", exact=True).click()
                assert disabled.value.status == 200, disabled.value.text()
                assert worker.request.get(base + "/api/admin/members").status == 401
                assert worker.request.post(base + "/api/auth/login", data={"identifier": employee_username, "password": replacement_password}).status == 401
                assert staff.request.get(base + "/api/admin/overview").status == 200
                assert_no_overflow(staff)
                staff.screenshot(path="/tmp/cana-admin-staff-accounts-mobile.png", full_page=True)
                print("PASS admin password reset and disable revoke employee sessions immediately while retaining administrator access", flush=True)

                staff.get_by_role("tab", name="Members", exact=True).click()
                staff.get_by_label("Search registered members", exact=True).fill(email)
                staff.get_by_role("button", name=f"Delete member {email}", exact=True).click()
                deletion = staff.get_by_role("region", name="Delete member confirmation")
                delete_button = deletion.get_by_role("button", name="Delete member permanently", exact=True)
                expect(delete_button).to_be_disabled()
                staff.get_by_label("Confirm member email for deletion", exact=True).fill("wrong@example.test")
                expect(delete_button).to_be_disabled()
                staff.get_by_label("Confirm member email for deletion", exact=True).fill(email)
                with staff.expect_response(lambda response: response.url.endswith(f"/api/admin/members/{member['id']}") and response.request.method == "DELETE") as deleted_member:
                    delete_button.click()
                assert deleted_member.value.status == 200, deleted_member.value.text()
                expect(staff.get_by_role("list", name="Registered members").get_by_role("listitem")).to_have_count(0)
                assert customer.request.get(base + "/api/members/me").json()["member"] is None
                assert customer.request.post(base + "/api/auth/login", data={"identifier": email, "password": "Local directory browser account password"}).status == 401
                assert_no_overflow(staff)
                staff.screenshot(path="/tmp/cana-member-deleted-mobile.png", full_page=True)
                print("PASS admin-only typed-email account deletion removes the member and revokes login while staff cannot delete", flush=True)
                browser.close()
                assert not errors, errors
                print("PASS zero uncaught browser errors", flush=True)
        finally:
            stop_fixture(process)


if __name__ == "__main__":
    run()
