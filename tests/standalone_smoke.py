"""Verify the exported public catalog without a server or network.

Run after npm run release. The catalog must remain honest about unavailable
online ordering; live order workflows have their own local integration suite.
"""
from pathlib import Path
import re
import zipfile
from playwright.sync_api import sync_playwright, expect

PREVIEW = Path(__file__).resolve().parents[1] / "release" / "loud-cana-preview.html"
HASH_DOCUMENT = "https://catalog.test/Cana/"


def exercise(app):
    expect(app.locator(".reference-hero")).to_be_visible()
    expect(app.locator(".featured-card")).to_have_count(5)
    expect(app.locator("#shop")).to_have_count(0)
    app.get_by_role("button", name="View gallery", exact=True).click()
    gallery = app.get_by_role("dialog", name="Loud + Cana store gallery")
    expect(gallery.get_by_role("heading")).to_have_text("The welcome")
    gallery.get_by_role("button", name="Next gallery image").click()
    expect(gallery.get_by_role("heading")).to_have_text("The collection")
    app.get_by_role("button", name="Close dialog", exact=True).click()
    app.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Membership", exact=True).click()
    expect(app.locator(".membership-page h1")).to_contain_text("Your people.")
    expect(app.locator(".membership-page").get_by_role("link", name="Create your account", exact=True)).to_have_attribute("href", "https://loud-cana.onrender.com/signup")
    expect(app.locator(".membership-page").get_by_role("link", name="Member login", exact=True)).to_have_attribute("href", "https://loud-cana.onrender.com/login")
    expect(app.locator(".membership-page form")).to_have_count(0)
    app.locator(".header-actions").get_by_role("link", name="Member login", exact=True).click()
    expect(app.locator(".membership-page")).to_contain_text("Account signup and login are available on our full website")
    expect(app.get_by_role("link", name="Open member website", exact=True)).to_have_attribute("href", "https://loud-cana.onrender.com/login")
    expect(app.locator(".membership-page input[type=password]")).to_have_count(0)
    app.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Shop", exact=True).click()
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
    app.get_by_role("button", name="I’m 18 or older", exact=True).click()
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
        for kind in ("inline-document", "opaque-iframe", "hashed-document"):
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            # The fake HTTPS origin below is fulfilled in memory, never fetched.
            # Only that initial/reloaded document is allowed; every asset/API
            # request must still be inline or the suite fails.
            def capture_request(request):
                allowed_document = kind == "hashed-document" and request.resource_type == "document" and request.url == HASH_DOCUMENT
                if request.url.startswith(("http:", "https:")) and not allowed_document:
                    network.append(request.url)
            page.on("request", capture_request)
            if kind == "hashed-document":
                def fulfill_document(route):
                    if route.request.resource_type == "document" and route.request.url == HASH_DOCUMENT:
                        route.fulfill(status=200, content_type="text/html", body=PREVIEW.read_text())
                    else:
                        route.abort()
                page.route("**/*", fulfill_document)
            else:
                page.route("http://**/*", lambda route: route.abort())
                page.route("https://**/*", lambda route: route.abort())
            if kind == "inline-document":
                # Managed browsers may block file://; use the exact export bytes.
                page.set_content(PREVIEW.read_text(), wait_until="load")
                app = page
            elif kind == "hashed-document":
                page.goto(HASH_DOCUMENT, wait_until="networkidle")
                app = page
            else:
                page.set_content('<iframe title="Standalone public catalog" sandbox="allow-scripts" style="width:100%;height:950px;border:0"></iframe>')
                page.locator("iframe").evaluate("(frame, html) => { frame.srcdoc = html; }", PREVIEW.read_text())
                app = page.frame_locator("iframe")
            exercise(app)
            if kind == "hashed-document":
                expect(page).to_have_url(re.compile(r"/Cana/#/shop$"))
                page.goto(HASH_DOCUMENT + "#/shop?category=Accessories", wait_until="networkidle")
                expect(page.locator(".product-card")).to_have_count(4)
                page.reload(wait_until="networkidle")
                expect(page).to_have_url(re.compile(r"#/shop\?category=Accessories$"))
                expect(page.locator(".product-card")).to_have_count(4)
                page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Membership", exact=True).click()
                expect(page).to_have_url(re.compile(r"#/membership$"))
                page.go_back(wait_until="networkidle")
                expect(page.locator(".product-card")).to_have_count(4)
                page.go_forward(wait_until="networkidle")
                expect(page.locator(".membership-page h1")).to_contain_text("Your people.")
                page.goto(HASH_DOCUMENT + "#/login", wait_until="networkidle")
                page.reload(wait_until="networkidle")
                expect(page.get_by_role("link", name="Open member website", exact=True)).to_have_attribute("href", "https://loud-cana.onrender.com/login")
                expect(page.locator(".membership-page input[type=password]")).to_have_count(0)
                page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Shop", exact=True).click()
                expect(page.locator(".product-card")).to_have_count(28)
                print("PASS GitHub Pages hash routes, direct filtered links, refresh, browser back/forward and honest static login", flush=True)
            # Bring all lazy images into view before inspecting the entire catalog.
            for image in app.locator("img").all():
                image.scroll_into_view_if_needed()
            expect(app.locator("img")).not_to_have_count(0)
            images_ok = app.locator("img").evaluate_all("async images => { await Promise.all(images.map(img => img.decode())); return images.every(img => img.complete && img.naturalWidth > 0); }")
            assert images_ok, f"{kind}: catalog images did not load"
            print(f"PASS {kind}: 28 products, page navigation, honest hosted-membership links, gallery, filters/search, product details, age confirmation, selection and local images", flush=True)
            context.close()
        browser.close()
    assert not errors, errors
    assert not network, f"Standalone catalog requested external assets: {network}"
    print("PASS standalone catalog has zero external requests and zero runtime errors", flush=True)


if __name__ == "__main__":
    run()
