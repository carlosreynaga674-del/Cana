"""Check membership barcode lookup on an isolated, non-selling local service.

Run after the production build. Barcode images are captured from the real card,
and camera lifecycle checks use Chromium's synthetic camera. No real identity
documents, camera devices, mail, or production records are used.
"""
import base64
from pathlib import Path
import re
import tempfile
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

from browser_age_helpers import register_member, synthetic_identity_images, workforce_sign_in
from membership_browser_smoke import (
    ADMIN_PASSWORD,
    assert_no_overflow,
    start_fixture,
    stop_fixture,
    unused_port,
)


CAMERA_MONITOR = """(() => {
  const native = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  window.__scannerCamera = { requests: [], streams: [] };
  if (native) navigator.mediaDevices.getUserMedia = async constraints => {
    window.__scannerCamera.requests.push(constraints);
    const stream = await native(constraints);
    window.__scannerCamera.streams.push(stream);
    return stream;
  };
})()"""


def open_scanner(page):
    page.get_by_role("tab", name="Scan member card", exact=True).click()
    expect(page.get_by_label("Membership number", exact=True)).to_be_visible()


def lookup(page, base, number):
    page.get_by_label("Membership number", exact=True).fill(number)
    with page.expect_response(lambda response: response.url == base + "/api/admin/members/lookup"
                              and response.request.method == "POST") as found:
        page.get_by_label("Membership number", exact=True).press("Enter")
    return found.value


def lookup_from_header(page, base, number):
    form = page.get_by_role("search", name="Search members by ID", exact=True)
    form.get_by_label("Search member ID", exact=True).fill(number)
    with page.expect_response(lambda response: response.url == base + "/api/admin/members/lookup"
                              and response.request.method == "POST") as found:
        form.get_by_label("Search member ID", exact=True).press("Enter")
    assert found.value.status == 200, found.value.text()
    expect(page.get_by_role("tab", name="Scan member card", exact=True)).to_have_attribute("aria-selected", "true")
    return found.value.json()["member"]


def upload_barcode(page, base, image):
    with page.expect_response(lambda response: response.url == base + "/api/admin/members/lookup"
                              and response.request.method == "POST", timeout=15000) as found:
        page.get_by_label("Barcode image", exact=True).set_input_files({
            "name": "local-membership-barcode.png", "mimeType": "image/png", "buffer": image,
        })
    assert found.value.status == 200, found.value.text()
    return found.value.json()["member"]


def result(page, member, status):
    panel = page.get_by_role("region", name="Member lookup result", exact=True)
    expect(panel).to_be_visible()
    expect(panel).to_contain_text(member["name"])
    expect(panel).to_contain_text(member["membershipNumber"])
    expect(panel.locator("[data-verification-status]")).to_have_attribute("data-verification-status", status)
    return panel


def run():
    errors, forbidden_writes = [], []
    name = "Local Barcode Member"
    email = "barcode-browser-" + uuid4().hex + "@example.test"
    password = "Local membership barcode browser password 42"
    worker_username = "barcode.reviewer"
    worker_password = "Local barcode reviewer password 84"

    def watch(context):
        context.on("page", lambda page: page.on("pageerror", lambda error: errors.append(str(error))))
        context.on("request", lambda request: forbidden_writes.append(request.url)
                   if request.method not in ("GET", "HEAD", "OPTIONS") and
                   re.search(r"/api/(?:admin/)?orders(?:/|$)", request.url) else None)

    with tempfile.TemporaryDirectory(prefix="cana-member-scanner-") as directory:
        process, base = start_fixture(Path(directory) / "scanner.sqlite", unused_port())
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=[
                    "--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
                ])
                customer = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=2)
                watch(customer)
                assert customer.request.post(base + "/api/admin/members/lookup", data={"membershipNumber": "LC-000000"}).status == 401
                member = register_member(customer, base, password, name=name, email=email)
                number = member["membershipNumber"]
                assert re.fullmatch(r"LC-\d{6}", number), number
                unknown_number = "LC-" + f"{(int(number[3:]) + 1) % 1000000:06d}"
                assert customer.request.post(base + "/api/admin/members/lookup", data={"membershipNumber": number}).status == 401
                card_page = customer.new_page()
                card_page.goto(base + "/account", wait_until="networkidle")
                barcode = card_page.get_by_role("img", name="Membership barcode", exact=True)
                expect(barcode).to_be_visible()
                image = barcode.screenshot()
                expect(card_page.locator(".member-card-status")).to_have_attribute("data-verification-status", "required")

                admin_context = browser.new_context(viewport={"width": 1440, "height": 1000})
                admin_context.add_init_script(CAMERA_MONITOR)
                watch(admin_context)
                admin = admin_context.new_page()
                workforce_sign_in(admin, base, "admin", ADMIN_PASSWORD)
                open_scanner(admin)
                assert admin.evaluate("window.__scannerCamera.requests.length") == 0, "Opening the scanner must not start a camera."
                response = lookup(admin, base, "  " + number.lower() + "  ")
                assert response.status == 200, response.text()
                assert response.json()["member"]["verified"] is False
                result(admin, member, "pending")
                found = lookup_from_header(admin, base, number[3:])
                assert found["id"] == member["id"]
                result(admin, member, "pending")
                print("PASS private lookup rejects public/member sessions and resolves manual barcode input as administrator", flush=True)

                created = admin_context.request.post(base + "/api/admin/staff", data={
                    "name": "Local Barcode Reviewer", "username": worker_username, "password": worker_password,
                })
                assert created.status == 201, created.text()
                worker_context = browser.new_context(viewport={"width": 390, "height": 844})
                worker_context.add_init_script(CAMERA_MONITOR)
                watch(worker_context)
                worker = worker_context.new_page()
                workforce_sign_in(worker, base, worker_username, worker_password)
                open_scanner(worker)
                found = upload_barcode(worker, base, image)
                assert found["id"] == member["id"] and found["verified"] is False
                result(worker, member, "pending")
                assert_no_overflow(worker)
                worker.screenshot(path="/tmp/cana-member-scanner-mobile.png", full_page=True)
                worker.get_by_role("button", name="Clear result", exact=True).click()
                expect(worker.get_by_role("region", name="Member lookup result", exact=True)).to_have_count(0)
                response = lookup(worker, base, number)
                assert response.status == 200, response.text()
                result(worker, member, "pending")
                found = lookup_from_header(worker, base, number)
                assert found["id"] == member["id"]
                result(worker, member, "pending")
                print("PASS real on-screen Code 128 PNG decodes in staff scanner, manual USB-style Enter works, mobile fits", flush=True)

                # A previously captured barcode is an account reference. Status
                # comes from the service on every lookup, not from that image.
                images = synthetic_identity_images()
                submitted = customer.request.post(base + "/api/members/identity-verification", data={
                    "identityConsent": True,
                    **{key: {"data": base64.b64encode(content).decode()} for key, content in images.items()},
                })
                assert submitted.status == 200, submitted.text()
                verification = submitted.json()["verification"]
                approved = admin_context.request.post(base + f"/api/admin/members/{member['id']}/age-verification", data={
                    "decision": "verified", "method": "uploaded_id_selfie",
                    "expectedSubmittedAt": verification["submittedAt"],
                    "expectedUploadId": verification["uploadId"],
                    "identityChecked": True, "ageChecked": True,
                })
                assert approved.status == 200, approved.text()
                found = upload_barcode(worker, base, image)
                assert found["verified"] is True
                result(worker, member, "verified")
                updated = customer.request.patch(base + "/api/members/me", data={"name": "Updated Local Barcode Member"})
                assert updated.status == 200, updated.text()
                member = updated.json()["member"]
                found = upload_barcode(worker, base, image)
                assert found["verified"] is False and found["name"] == member["name"]
                result(worker, member, "required")
                print("PASS old barcode image returns current approved/required states and current name", flush=True)

                response = lookup(worker, base, unknown_number)
                assert response.status == 404, response.text()
                expect(worker.get_by_role("alert")).to_be_visible()
                expect(worker.get_by_role("region", name="Member lookup result", exact=True)).to_have_count(0)
                worker.get_by_label("Membership number", exact=True).fill("https://example.test/not-a-member")
                worker.get_by_label("Membership number", exact=True).press("Enter")
                expect(worker.get_by_role("alert")).to_be_visible()
                expect(worker).to_have_url(base + "/staff")
                response = lookup(worker, base, number)
                assert response.status == 200
                result(worker, member, "required").get_by_role("button", name="Open member record", exact=True).click()
                expect(worker.get_by_role("tab", name="Members", exact=True)).to_have_attribute("aria-selected", "true")
                expect(worker.get_by_role("list", name="Registered members")).to_contain_text(member["name"])

                # The document began at /login and used SPA navigation. Its
                # camera policy must still permit an explicit scanner action.
                admin.get_by_role("button", name="Start camera", exact=True).click()
                expect(admin.get_by_role("button", name="Stop camera", exact=True)).to_be_visible()
                admin.wait_for_function("() => window.__scannerCamera.streams.some(stream => stream.getTracks().some(track => track.readyState === 'live'))")
                assert admin.evaluate("window.__scannerCamera.requests.every(request => request.audio === false)")
                admin.get_by_role("button", name="Stop camera", exact=True).click()
                admin.wait_for_function("() => window.__scannerCamera.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))")
                admin.get_by_role("button", name="Start camera", exact=True).click()
                admin.wait_for_function("() => window.__scannerCamera.streams.some(stream => stream.getTracks().some(track => track.readyState === 'live'))")
                admin.get_by_role("tab", name="Members", exact=True).click()
                admin.wait_for_function("() => window.__scannerCamera.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))")
                open_scanner(admin)
                assert admin.evaluate("window.__scannerCamera.requests.length") == 2
                # Feed the real captured barcode through a synthetic live video
                # stream as well, exercising camera frame decoding end to end.
                admin.evaluate("""png => {
                  navigator.mediaDevices.getUserMedia = async constraints => {
                    window.__scannerCamera.requests.push(constraints);
                    const image = new Image();
                    image.src = 'data:image/png;base64,' + png;
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = 1280; canvas.height = 720;
                    const context = canvas.getContext('2d');
                    const draw = () => {
                      context.fillStyle = '#ffffff';
                      context.fillRect(0, 0, canvas.width, canvas.height);
                      context.imageSmoothingEnabled = false;
                      context.drawImage(image, 100, 200, 1080, 316);
                    };
                    draw();
                    const stream = canvas.captureStream(15);
                    const timer = setInterval(() => {
                      if (stream.getTracks().every(track => track.readyState === 'ended')) clearInterval(timer);
                      else draw();
                    }, 50);
                    window.__scannerCamera.streams.push(stream);
                    return stream;
                  };
                }""", base64.b64encode(image).decode())
                with admin.expect_response(lambda response: response.url == base + "/api/admin/members/lookup"
                                           and response.request.method == "POST", timeout=15000) as video_match:
                    admin.get_by_role("button", name="Start camera", exact=True).click()
                assert video_match.value.status == 200, video_match.value.text()
                assert video_match.value.json()["member"]["id"] == member["id"]
                result(admin, member, "required")
                admin.wait_for_function("() => window.__scannerCamera.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))")
                admin.evaluate("() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied by local browser fixture', 'NotAllowedError'); }; }")
                admin.get_by_role("button", name="Start camera", exact=True).click()
                expect(admin.get_by_role("alert")).to_be_visible()
                expect(admin.get_by_label("Membership number", exact=True)).to_be_enabled()
                response = lookup(admin, base, number)
                assert response.status == 200, response.text()
                result(admin, member, "required")
                assert_no_overflow(admin)
                print("PASS camera starts only on request, stops explicitly/on tab change, and denied permission keeps manual lookup working", flush=True)
                browser.close()
        finally:
            stop_fixture(process)
    assert not errors, errors
    assert not forbidden_writes, forbidden_writes
    print("PASS membership scanner has zero uncaught browser errors, real-camera use, production mail or order writes", flush=True)


if __name__ == "__main__":
    run()
