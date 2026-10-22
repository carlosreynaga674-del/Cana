"""Verify the exported preview without a server or network.

Run after `npm run build` and `node scripts/build-standalone.mjs`:
    python3 tests/standalone_smoke.py
"""
from pathlib import Path
import re
import zipfile
from playwright.sync_api import sync_playwright, expect

PREVIEW = Path(__file__).resolve().parents[1] / "release" / "loud-cana-preview.html"


def exercise(app):
    expect(app.locator(".product-card")).to_have_count(8)
    app.get_by_role("button", name="Flower", exact=True).click()
    expect(app.locator(".product-card")).to_have_count(2)
    app.get_by_role("button", name="All good things").click()
    app.get_by_role("button", name="Add Peach State to bag", exact=True).click()
    app.get_by_role("button", name="I’m 21 or older", exact=True).click()
    app.get_by_role("button", name="Open bag, 1 items").click()
    expect(app.locator(".total-line")).to_contain_text("R")
    app.get_by_role("button", name="Let’s check out").click()
    app.get_by_label("Full name", exact=True).fill("Client Demo")
    app.get_by_label("Email address", exact=True).fill("client@example.com")
    app.get_by_label("Phone number", exact=True).fill("0123456789")
    app.get_by_label("Street address", exact=True).fill("123 Demo Lane")
    app.get_by_label("City", exact=True).fill("Johannesburg")
    app.get_by_label(re.compile(r"^(ZIP code|Postal code)$")).fill("2196")
    app.get_by_role("checkbox").check()
    app.get_by_role("button", name=re.compile("Place demo order")).click()
    expect(app.get_by_role("dialog", name="Order confirmation")).to_be_visible()
    expect(app.locator(".order-number strong")).to_contain_text("LC-")


def run():
    errors, network = [], []
    archive = PREVIEW.parent / "loud-cana-client.zip"
    if archive.exists():
        with zipfile.ZipFile(archive) as release:
            assert release.read("static-site/index.html") == PREVIEW.read_bytes(), "Static demo must use the same standalone HTML for subpath hosting"
        print("PASS packaged static index is the self-contained preview, safe for repository subpaths")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
        for kind in ("inline-document", "opaque-iframe"):
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: network.append(request.url) if request.url.startswith(("http:", "https:")) else None)
            page.route("http://**/*", lambda route: route.abort())
            page.route("https://**/*", lambda route: route.abort())
            if kind == "inline-document":
                # The managed cloud browser blocks all file:// navigation by
                # administrator policy. Load the exact exported bytes instead.
                page.set_content(PREVIEW.read_text(), wait_until="load")
                app = page
            else:
                page.set_content('<iframe title="Standalone client preview" sandbox="allow-scripts" style="width:100%;height:950px;border:0"></iframe>')
                page.locator("iframe").evaluate("(frame, html) => { frame.srcdoc = html; }", PREVIEW.read_text())
                app = page.frame_locator("iframe")
            exercise(app)
            app.get_by_role("button", name="Close dialog", exact=True).click()
            app.locator(".brand-note").scroll_into_view_if_needed()
            images_ok = app.locator("img").evaluate_all("images => images.every(img => img.complete && img.naturalWidth > 0)")
            assert images_ok, f"{kind}: product images did not load"
            print(f"PASS {kind}: 8 products, filters, age confirmation, cart, checkout, confirmation and local images")
            context.close()
        browser.close()
    assert not errors, errors
    assert not network, f"Standalone preview requested external assets: {network}"
    print("PASS standalone preview has zero external requests and zero runtime errors")


if __name__ == "__main__":
    run()
