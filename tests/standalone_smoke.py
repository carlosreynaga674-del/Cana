"""Verify the exported public catalog without a server or network.

Run after npm run release. The catalog must remain honest about unavailable
online ordering; live order workflows have their own local integration suite.
"""
from pathlib import Path
import re
import zipfile
from playwright.sync_api import sync_playwright, expect

PREVIEW = Path(__file__).resolve().parents[1] / "release" / "loud-cana-preview.html"


def exercise(app):
    expect(app.locator(".reference-hero")).to_be_visible()
    expect(app.locator(".featured-card")).to_have_count(5)
    expect(app.locator("#shop")).to_be_hidden()
    app.get_by_role("button", name="View gallery", exact=True).click()
    gallery = app.get_by_role("dialog", name="Loud + Cana store gallery")
    expect(gallery.get_by_role("heading")).to_have_text("The welcome")
    gallery.get_by_role("button", name="Next gallery image").click()
    expect(gallery.get_by_role("heading")).to_have_text("The collection")
    app.get_by_role("button", name="Close dialog", exact=True).click()
    app.get_by_role("navigation", name="Main navigation").get_by_role("button", name="Shop", exact=True).click()
    expect(app.locator("#shop")).to_be_visible()
    expect(app.locator(".product-card")).to_have_count(28)
    expect(app.get_by_text("CLIENT PREVIEW", exact=True)).to_have_count(0)
    app.get_by_role("group", name="Product categories").get_by_role("button", name="Flower", exact=True).click()
    expect(app.locator(".product-card")).to_have_count(6)
    app.get_by_role("group", name="Product categories").get_by_role("button").first.click()
    app.get_by_label("Search products").fill("Peach State")
    expect(app.locator(".product-card")).to_have_count(1)
    app.get_by_label("Search products").fill("")
    app.get_by_role("button", name="View Peach State", exact=True).click()
    expect(app.get_by_role("dialog")).to_contain_text("Peach State")
    app.get_by_role("button", name="Close dialog", exact=True).click()
    app.get_by_role("button", name="Add Peach State to bag", exact=True).click()
    app.get_by_role("button", name="I’m 21 or older", exact=True).click()
    app.get_by_role("button", name="Open bag, 1 items").click()
    expect(app.locator(".total-line")).to_contain_text("R")
    app.get_by_role("button", name="Increase Peach State quantity").click()
    expect(app.locator(".quantity span")).to_have_text("2")
    expect(app.get_by_role("button", name=re.compile("ordering.*not.*available", re.I))).to_be_disabled()
    expect(app.get_by_role("button", name=re.compile("Place demo order|Let.s check out|Submit order request"))).to_have_count(0)
    expect(app.get_by_role("dialog", name="Order confirmation")).to_have_count(0)
    app.get_by_role("button", name="Remove Peach State", exact=True).click()
    expect(app.locator(".empty-bag")).to_be_visible()
    app.get_by_role("button", name="Close dialog", exact=True).click()


def run():
    errors, network = [], []
    archive = PREVIEW.parent / "loud-cana-client.zip"
    if archive.exists():
        with zipfile.ZipFile(archive) as release:
            assert release.read("static-site/index.html") == PREVIEW.read_bytes(), "Static index must use the same standalone HTML for subpath hosting"
        print("PASS packaged static index is self-contained and safe for repository subpaths", flush=True)
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
                # Managed browsers may block file://; use the exact export bytes.
                page.set_content(PREVIEW.read_text(), wait_until="load")
                app = page
            else:
                page.set_content('<iframe title="Standalone public catalog" sandbox="allow-scripts" style="width:100%;height:950px;border:0"></iframe>')
                page.locator("iframe").evaluate("(frame, html) => { frame.srcdoc = html; }", PREVIEW.read_text())
                app = page.frame_locator("iframe")
            exercise(app)
            # Bring all lazy images into view before inspecting the entire catalog.
            for image in app.locator("img").all():
                image.scroll_into_view_if_needed()
            expect(app.locator("img")).not_to_have_count(0)
            images_ok = app.locator("img").evaluate_all("async images => { await Promise.all(images.map(img => img.decode())); return images.every(img => img.complete && img.naturalWidth > 0); }")
            assert images_ok, f"{kind}: catalog images did not load"
            print(f"PASS {kind}: 28 products and reference gallery, filters/search, product details, age confirmation, selection, honest ordering state and local images", flush=True)
            context.close()
        browser.close()
    assert not errors, errors
    assert not network, f"Standalone catalog requested external assets: {network}"
    print("PASS standalone catalog has zero external requests and zero runtime errors", flush=True)


if __name__ == "__main__":
    run()
