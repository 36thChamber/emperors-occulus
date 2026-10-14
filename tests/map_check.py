"""Read-only browser QA of georeferencing and map navigation."""

from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1450, "height": 1100})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8765")
    page.locator("#area option").first.wait_for(state="attached", timeout=60000)
    page.select_option("#quality", "96")
    page.click("#load")
    expect(page.locator("#message")).to_contain_text(
        "Visão estabelecida", timeout=90000
    )
    print(
        "loaded:",
        page.locator("#map-subtitle").inner_text(),
        page.locator("#read-info").inner_text(),
        flush=True,
    )
    print("bounds:", page.evaluate("window.occulusMap.getBounds()"), flush=True)
    assert page.locator(".leaflet-image-layer").count() == 1
    page.evaluate("window.occulusMap.zoomIn(1)")
    page.wait_for_timeout(2000)
    expect(page.locator("#message")).to_contain_text(
        "Visão estabelecida", timeout=90000
    )
    dates = page.locator("#compare option").evaluate_all(
        "(a)=>a.map(x=>x.value).filter(Boolean)"
    )
    page.select_option("#compare", dates[1])
    expect(page.locator("#comparison")).to_be_visible(timeout=90000)
    assert page.locator(".leaflet-image-layer").count() == 2
    page.locator("#opacity").fill("0.5")
    page.locator("#swipe").fill("25")
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth<=window.innerWidth")
    print("browser errors:", errors)
    assert not errors
    browser.close()
