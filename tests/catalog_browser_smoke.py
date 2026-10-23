"""Check a staff-published catalog, current bag prices, and withdrawn products.

Run after npm run build. Everything uses a temporary loopback server/database;
no production products, accounts, verification decisions or orders are created.
"""
from pathlib import Path
import re
import tempfile

from playwright.sync_api import sync_playwright, expect
from membership_browser_smoke import start_fixture, stop_fixture, unused_port, ADMIN_PASSWORD


def run():
    errors, order_posts = [], []
    with tempfile.TemporaryDirectory(prefix="cana-catalog-browser-") as directory:
        process, base = start_fixture(Path(directory) / "catalog.sqlite", unused_port())
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
                staff = browser.new_context()
                login = staff.request.post(base + "/api/admin/login", data={"password": ADMIN_PASSWORD})
                assert login.status == 200, login.text()
                response = staff.request.post(base + "/api/admin/products", data={
                    "id": "browser-managed-product", "name": "Browser Managed Grinder",
                    "category": "Accessories", "type": "Accessory", "size": "One piece",
                    "description": "A local browser test fixture that is never published to production.",
                    "price": 12345, "featured": True,
                    "imageUrl": "/images/missing-catalog-test.webp",
                })
                assert response.status == 201, response.text()
                product = response.json()["product"]
                assert product["status"] == "draft"
                context = browser.new_context(viewport={"width": 1440, "height": 1000})
                context.add_init_script("localStorage.setItem('lc-age-confirmed', 'true');")
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: order_posts.append(request.url) if request.method == "POST" and "/api/orders" in request.url else None)
                page.goto(base + "/shop?q=Browser+Managed", wait_until="networkidle")
                expect(page.locator(".product-card")).to_have_count(0)

                response = staff.request.patch(base + f"/api/admin/products/{product['id']}", data={"revision": product["revision"], "status": "published"})
                assert response.status == 200, response.text()
                product = response.json()["product"]
                page.reload(wait_until="networkidle")
                expect(page.locator(".product-card")).to_have_count(1)
                card = page.locator(".product-card")
                expect(card).to_contain_text("Browser Managed Grinder")
                expect(card.locator("img")).to_have_attribute("src", "/images/reference-accessory.webp")
                card.get_by_role("button", name="Add Browser Managed Grinder to bag", exact=True).click()
                page.reload(wait_until="networkidle")
                page.get_by_role("button", name="Open bag, 1 items", exact=True).click()
                bag = page.get_by_role("dialog", name="Your bag")
                expect(bag.locator(".cart-item-price")).to_contain_text(re.compile(r"R\s*123[,.]45"))
                print("PASS draft is private, published custom product appears, bad image falls back, custom bag survives reload", flush=True)

                response = staff.request.patch(base + f"/api/admin/products/{product['id']}", data={"revision": product["revision"], "price": 19900})
                assert response.status == 200, response.text()
                product = response.json()["product"]
                page.evaluate("window.dispatchEvent(new Event('focus'))")
                expect(bag.locator(".cart-item-price")).to_contain_text(re.compile(r"R\s*199[,.]00"))
                expect(page.locator(".toast")).to_contain_text("selection has changed")
                response = staff.request.delete(base + f"/api/admin/products/{product['id']}", data={"revision": product["revision"]})
                assert response.status == 200, response.text()
                page.evaluate("window.dispatchEvent(new Event('focus'))")
                expect(bag.locator(".cart-item")).to_have_count(0)
                bag.get_by_role("button", name="Close dialog", exact=True).click()
                expect(page.locator(".product-card")).to_have_count(0)
                print("PASS live price changes reconcile the bag and archived products leave both storefront and bag", flush=True)

                context.route("**/api/products", lambda route: route.fulfill(status=503, json={"error": "Temporary test failure"}))
                page.reload(wait_until="networkidle")
                expect(page.get_by_role("heading", name="The collection is unavailable.")).to_be_visible()
                expect(page.locator(".product-card")).to_have_count(0)
                context.unroute("**/api/products")
                page.get_by_role("button", name="Try again", exact=True).click()
                expect(page.get_by_role("heading", name="The collection is unavailable.")).to_have_count(0)
                page.get_by_label("Search products", exact=True).fill("")
                expect(page.locator(".product-card")).to_have_count(28)
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "Mobile catalog overflow"
                assert not errors, errors
                assert not order_posts, order_posts
                print("PASS API failure has a working retry with no seed fallback; mobile layout and runtime checks pass", flush=True)
                staff.close()
                context.close()
                browser.close()
        finally:
            stop_fixture(process)


if __name__ == "__main__":
    run()
