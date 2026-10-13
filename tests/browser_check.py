"""Manual integration check against the local server; uses real read-only S3 previews."""

from playwright.sync_api import sync_playwright, expect
from pathlib import Path

Path("artifacts").mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8765")
    page.locator("#area option").first.wait_for(state="attached", timeout=60000)
    page.select_option("#quality", "96")
    page.click("#load")
    expect(page.locator("#message")).to_contain_text("Prévia pronta", timeout=60000)
    print("UI", page.locator("#info-a").inner_text(), flush=True)
    page.screenshot(path="artifacts/desktop.png", full_page=True)
    page.click("#zoom")
    expect(page.locator("#crop-status")).to_contain_text("2.0", timeout=60000)
    dates = page.locator("#compare option").evaluate_all(
        "(opts)=>opts.map(x=>x.value).filter(Boolean)"
    )
    page.select_option("#compare", dates[1])
    page.click("#load")
    expect(page.locator("#message")).to_contain_text("Prévia pronta", timeout=60000)
    assert page.locator("#panel-b").is_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path="artifacts/mobile.png", full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    print("comparison and mobile OK; browser errors:", errors)
    assert not errors
    browser.close()
