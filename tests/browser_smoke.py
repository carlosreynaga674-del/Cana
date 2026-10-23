"""Public catalog browser checks for Loud + Cana.

Build and start the unconfigured (catalog-only) server, then run this script.
Real-order workflows are covered separately by live_browser_smoke.py using
fictitious local-only configuration and a temporary database.
"""
import os
import re
from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("CANA_BASE_URL", "http://127.0.0.1:3000")
PRODUCT_COUNT = 28


def expect_money(locator, cents):
    formatted = f"{cents / 100:,.2f}".replace(",", " ").replace(".", ",")
    pattern = r"R\s*" + re.escape(formatted).replace(r"\ ", r"\s*")
    expect(locator).to_contain_text(re.compile(pattern))


def close_dialog(page):
    page.get_by_role("dialog").get_by_role("button", name="Close dialog").click()


def open_shop(page):
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Shop", exact=True).click()
    expect(page.locator("#shop")).to_be_visible()


def all_products(page):
    page.get_by_role("group", name="Product categories").get_by_role("button").first.click()


def assert_catalog_only(page):
    expect(page.get_by_text("CLIENT PREVIEW", exact=True)).to_have_count(0)
    expect(page.get_by_role("button", name=re.compile("Place demo order", re.I))).to_have_count(0)
    expect(page.get_by_role("button", name=re.compile("ordering.*not.*available", re.I))).to_be_disabled()
    expect(page.get_by_role("button", name=re.compile("Let.s check out|Submit order request"))).to_have_count(0)
    expect(page.get_by_role("dialog", name="Order confirmation")).to_have_count(0)


def run():
    errors, order_submissions = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: order_submissions.append(request.url) if request.method == "POST" and "/api/orders" in request.url else None)
        page.goto(BASE_URL, wait_until="networkidle")
        expect(page.locator(".reference-hero")).to_be_visible()
        expect(page.locator(".hero-loud")).to_have_text("LOUD")
        expect(page.locator(".hero-cana")).to_have_text("+CANA")
        expect(page.locator(".category-card")).to_have_count(5)
        expect(page.locator(".featured-card")).to_have_count(5)
        expect(page.locator("#shop")).to_have_count(0)
        page.get_by_role("button", name="View gallery", exact=True).click()
        gallery = page.get_by_role("dialog", name="Loud + Cana store gallery")
        expect(gallery.get_by_role("heading")).to_have_text("The welcome")
        gallery.get_by_role("button", name="Next gallery image").click()
        expect(gallery.get_by_role("heading")).to_have_text("The collection")
        gallery.get_by_role("button", name="Previous gallery image").click()
        expect(gallery.get_by_role("heading")).to_have_text("The welcome")
        close_dialog(page)
        page.screenshot(path="/tmp/lc-reference-desktop.png", full_page=True)
        page.get_by_role("button", name="Discover membership", exact=True).click()
        expect(page).to_have_url(re.compile(r"/membership$"))
        expect(page.locator(".membership-page h1")).to_contain_text("Your people.")
        expect(page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Membership", exact=True)).to_have_attribute("aria-current", "page")
        page.locator(".membership-page").get_by_role("link", name="Member login", exact=True).click()
        expect(page).to_have_url(re.compile(r"/login$"))
        expect(page.locator(".auth-form")).to_be_visible()
        expect(page.get_by_label("Email address", exact=True)).to_be_visible()
        page.go_back(wait_until="networkidle")
        expect(page.locator(".membership-page h1")).to_contain_text("Your people.")
        page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Home", exact=True).click()
        expect(page.locator(".reference-hero")).to_be_visible()
        print("PASS reference-themed landing page, five categories/top picks, gallery, dedicated membership/login pages and browser history", flush=True)
        open_shop(page)
        expect(page.locator(".product-card")).to_have_count(PRODUCT_COUNT)
        expect(page.get_by_text("CLIENT PREVIEW", exact=True)).to_have_count(0)
        for category, count in [("Flower", 6), ("Pre-rolls", 5), ("Edibles", 5), ("Vapes", 4), ("Drinks", 4), ("Accessories", 4)]:
            page.get_by_role("group", name="Product categories").get_by_role("button", name=category, exact=True).click()
            expect(page.locator(".product-card")).to_have_count(count)
        all_products(page)
        page.get_by_label("Filter by collection").select_option("Reserve")
        expect(page.locator(".product-card")).to_have_count(10)
        page.get_by_label("Filter by collection").select_option("All collections")
        expect(page.locator(".product-card")).to_have_count(PRODUCT_COUNT)
        page.get_by_label("Search products").fill("nothing-like-this")
        expect(page.locator(".product-card")).to_have_count(0)
        expect(page.locator(".empty-results")).to_be_visible()
        page.get_by_label("Search products").fill("velvet")
        expect(page.locator(".product-card")).to_have_count(2)
        page.get_by_label("Search products").fill("")
        page.get_by_label("Sort products").select_option("price-low")
        expect(page.locator(".product-name").first).to_have_text("Unbleached Papers")
        page.get_by_label("Sort products").select_option("price-high")
        expect(page.locator(".product-name").first).to_have_text("Midnight Reserve")
        page.get_by_label("Sort products").select_option("featured")
        page.get_by_role("button", name="Save Sunset Sherbet", exact=True).click()
        page.locator(".saved-filter").click()
        expect(page.locator(".product-card")).to_have_count(1)
        page.reload(wait_until="networkidle")
        open_shop(page)
        expect(page.get_by_role("button", name="Unsave Sunset Sherbet", exact=True)).to_have_attribute("aria-pressed", "true")
        print("PASS 28-item catalog, all categories, search, price sorting and persisted saved selection", flush=True)

        page.locator(".location-button").click()
        page.get_by_role("button", name="Save my neighborhood").click()
        expect(page.get_by_text("Enter a 4-digit South African postal code.")).to_be_visible()
        page.get_by_label("Your Postal code").fill("2196")
        page.get_by_role("button", name="Save my neighborhood").click()
        expect(page.locator(".location-button")).to_contain_text("2196")
        print("PASS South African postal-code validation and saved location preference", flush=True)

        page.get_by_role("button", name="Add Sunset Sherbet to bag", exact=True).click()
        expect(page.get_by_role("dialog", name="Confirm your age")).to_be_visible()
        page.get_by_role("button", name="I’m under 21", exact=True).click()
        expect(page.get_by_role("dialog", name="Age restriction")).to_be_visible()
        page.get_by_role("button", name="Got it", exact=True).click()
        expect(page.locator(".bag-count")).to_have_text("0")
        page.get_by_role("button", name="View Sunset Sherbet", exact=True).click()
        page.get_by_label("Your size").select_option("1")
        page.get_by_role("button", name="Increase Sunset Sherbet quantity").click()
        expect_money(page.get_by_role("button", name=re.compile("^Add to (bag|selection)")), 116000)
        page.get_by_role("button", name=re.compile("^Add to (bag|selection)")).click()
        page.get_by_role("button", name="I’m 21 or older", exact=True).click()
        expect(page.locator(".bag-count")).to_have_text("2")
        page.get_by_role("button", name="Open bag, 2 items").click()
        expect(page.get_by_role("dialog")).to_contain_text("7 g")
        expect_money(page.locator(".total-line"), 116000)
        page.get_by_role("button", name="Decrease Sunset Sherbet quantity").click()
        expect_money(page.locator(".total-line"), 58000)
        assert_catalog_only(page)
        expect(page.get_by_label("Promo code")).to_have_count(0)
        close_dialog(page)
        page.reload(wait_until="networkidle")
        expect(page.locator(".bag-count")).to_have_text("1")
        page.get_by_role("button", name="Open bag, 1 items").click()
        expect_money(page.locator(".total-line"), 58000)
        assert_catalog_only(page)
        page.get_by_role("button", name="Remove Sunset Sherbet").click()
        expect(page.locator(".empty-bag")).to_be_visible()
        close_dialog(page)
        print("PASS age denial/confirmation, product size and quantities, persistent selection and honest catalog-only ordering state", flush=True)
        context.close()

        mobile = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, device_scale_factor=1)
        page = mobile.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: order_submissions.append(request.url) if request.method == "POST" and "/api/orders" in request.url else None)
        page.goto(BASE_URL, wait_until="networkidle")
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), "Mobile page overflows horizontally"
        page.get_by_role("button", name="Toggle navigation").click()
        expect(page.get_by_role("navigation", name="Main navigation")).to_be_visible()
        page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="About", exact=True).click()
        expect(page).to_have_url(re.compile(r"/about$"))
        expect(page.get_by_role("heading", name="More than cannabis.", level=1, exact=True)).to_be_visible()
        expect(page.locator('.nav-links a[href="/about"]')).to_have_attribute("aria-current", "page")
        expect(page.get_by_role("button", name="Toggle navigation")).to_have_attribute("aria-expanded", "false")
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), "Mobile About page overflows horizontally"
        page.get_by_role("button", name="Toggle navigation").click()
        open_shop(page)
        expect(page.get_by_role("button", name="Toggle navigation")).to_have_attribute("aria-expanded", "false")
        page.get_by_role("group", name="Product categories").get_by_role("button", name="Vapes", exact=True).click()
        expect(page.locator(".product-card")).to_have_count(4)
        all_products(page)
        page.get_by_label("Search products").fill("Peach State")
        expect(page.locator(".product-card")).to_have_count(1)
        page.get_by_role("button", name="Add Peach State to bag", exact=True).click()
        page.get_by_role("button", name="I’m 21 or older", exact=True).click()
        page.get_by_role("button", name="Open bag, 1 items").click()
        page.get_by_role("button", name="Increase Peach State quantity").click()
        expect_money(page.locator(".total-line"), 40000)
        assert_catalog_only(page)
        page.get_by_role("button", name="Remove Peach State").click()
        expect(page.locator(".empty-bag")).to_be_visible()
        close_dialog(page)
        page.get_by_label("Search products").fill("")
        page.screenshot(path="/tmp/lc-reference-mobile.png",full_page=True)
        print("PASS mobile navigation, categories/search, selection quantity/remove, no misleading checkout and no horizontal overflow", flush=True)
        mobile.close()

        malformed = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = malformed.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: order_submissions.append(request.url) if request.method == "POST" and "/api/orders" in request.url else None)
        page.goto(BASE_URL, wait_until="networkidle")
        page.evaluate("""() => {
            localStorage.setItem('lc-cart', JSON.stringify([null, {id:'sunset-sherbet',size:'7 g',quantity:1,price:1}, {id:'unknown-product',quantity:9}]));
            localStorage.setItem('lc-favorites', JSON.stringify({invalid:true}));
            localStorage.setItem('lc-location', JSON.stringify({postcode:'90210',mode:'unknown'}));
            localStorage.setItem('lc-orders', JSON.stringify([null,{}, {serverBacked:false}]));
            localStorage.setItem('lc-age-confirmed', JSON.stringify('false'));
        }""")
        page.reload(wait_until="networkidle")
        open_shop(page)
        expect(page.locator(".product-card")).to_have_count(PRODUCT_COUNT)
        expect(page.locator(".bag-count")).to_have_text("1")
        page.get_by_role("button", name="Open bag, 1 items").click()
        expect_money(page.locator(".total-line"), 58000)
        expect(page.locator(".cart-item")).to_have_count(1)
        assert page.evaluate("JSON.parse(localStorage.getItem('lc-cart'))[0].price") == 58000
        assert page.evaluate("JSON.parse(localStorage.getItem('lc-location')).mode") == "delivery"
        assert page.evaluate("JSON.parse(localStorage.getItem('lc-orders')).length") == 0
        assert_catalog_only(page)
        close_dialog(page)
        page.get_by_role("button", name="Add Peach State to bag", exact=True).click()
        expect(page.get_by_role("dialog", name="Confirm your age")).to_be_visible()
        malformed.close()
        print("PASS safe hydration, unknown-item rejection, authoritative catalog prices and strict age confirmation", flush=True)
        browser.close()
    assert not errors, errors
    assert not order_submissions, order_submissions
    print("PASS no fabricated order submissions and no uncaught browser errors", flush=True)


if __name__ == "__main__":
    run()
