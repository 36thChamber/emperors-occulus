"""Read-only live S3 verification of each added module's actual TIFF encoding."""

from playwright.sync_api import sync_playwright, expect
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(os.getenv("OCCULUS_TEST_URL", "http://127.0.0.1:8765"))
    page.locator("#area option").first.wait_for(state="attached", timeout=60000)
    for module, area, region in [
        ("ste", "Alouatta_caraya", "poligono_30m"),
        ("siapresp", "camarao", "atlantic"),
    ]:
        page.select_option("#module", module)
        expect(page.locator("#module-note")).to_have_text(
            "SIAPESQ" if module == "ste" else "SIAPRESP", timeout=90000
        )
        page.select_option("#area", area)
        page.select_option("#region", region)
        page.select_option("#quality", "96")
        page.click("#load")
        try:
            page.locator("#message").filter(has_text="Visão estabelecida").or_(
                page.locator("#message.error")
            ).wait_for(timeout=120000)
            assert "Visão estabelecida" in page.locator("#message").inner_text()
        except Exception:
            print(
                "FAILED",
                module,
                page.locator("#message").inner_text(),
                errors,
                flush=True,
            )
            raise
        print(
            module,
            page.locator("#catalog-status").inner_text(),
            page.locator("#map-subtitle").inner_text(),
            page.locator("#read-info").inner_text(),
            flush=True,
        )
        assert page.locator(".leaflet-image-layer").count() == 1
        assert page.locator("#legend-min").inner_text() == "0"
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
    print("browser errors", errors)
    assert not errors
    browser.close()
