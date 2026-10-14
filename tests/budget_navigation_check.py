"""An over-budget initial view must still allow zooming into a smaller crop."""

from playwright.sync_api import sync_playwright, expect
from urllib.parse import urlparse, parse_qs

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()

    def catalog(r):
        module = parse_qs(urlparse(r.request.url).query).get("module", ["phytobloom"])[
            0
        ]
        item = {
            "area": "camarao" if module == "siapresp" else "165",
            "product": "mean" if module == "siapresp" else "NDCI",
            "module": module,
            "region": "",
            "date": "2026-10-12",
            "key": "fixture",
            "bytes": 1000,
            "etag": "v",
        }
        r.fulfill(json={"items": [item], "updated": 1})

    page.route("**/api/catalog*", catalog)
    page.route(
        "**/api/config",
        lambda r: r.fulfill(json={"hosted": False, "googleMapsKey": ""}),
    )
    page.goto("http://127.0.0.1:8765")
    page.locator("#area option").first.wait_for(state="attached")
    page.evaluate("""()=>{
      const meta={w:100,h:100,c:1,origin:[-60,7],scale:[.1,.1],epsg:4326,toGeo:proj4('EPSG:4326','EPSG:4326')};
      OcculusRaster.header=async()=>meta;let calls=0;
      OcculusRaster.preview=async(item,res,crop)=>{
        if(++calls===1)throw Error('Este recorte exigiria mais de 16 MiB. Aproxime o mapa.');
        const c=document.createElement('canvas');c.width=c.height=2;
        return {url:c.toDataURL(),bounds:[[-3,-60],[7,-50]],size:[2,2],meta,crop,transferred:0,cached:false};
      };
    }""")
    page.select_option("#module", "siapresp")
    expect(page.locator("#module-note")).to_have_text("SIAPRESP")
    page.select_option("#region", "integral")
    page.click("#load")
    expect(page.locator("#message")).to_contain_text("16 MiB")
    page.evaluate("window.occulusMap.setView([-2,-55],9,{animate:false})")
    expect(page.locator("#message")).to_contain_text(
        "Visão estabelecida", timeout=15000
    )
    assert page.locator(".leaflet-image-layer").count() == 1
    print("Budget refusal -> zoom -> bounded retry verified")
    b.close()
