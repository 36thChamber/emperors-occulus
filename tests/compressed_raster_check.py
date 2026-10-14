"""Validate decoded LZW/DEFLATE float pixels against generated source arrays; no AWS."""

import io, json
from urllib.parse import urlparse, parse_qs
import numpy as np, rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from playwright.sync_api import sync_playwright

fixtures = {}
source = (np.arange(64 * 64, dtype="float32").reshape(64, 64) % 101) / 100
source[0, 0] = np.nan
for codec in ["LZW", "DEFLATE"]:
    with MemoryFile() as mem:
        profile = dict(
            driver="GTiff",
            width=64,
            height=64,
            count=1,
            dtype="float32",
            crs="EPSG:4326",
            transform=from_origin(-55, -29, 0.01, 0.01),
            nodata=float("nan"),
            compress=codec,
            predictor=3,
        )
        if codec == "DEFLATE":
            profile.update(tiled=True, blockxsize=16, blockysize=16)
        else:
            profile.update(tiled=False, blockysize=1, interleave="band")
        with mem.open(**profile) as d:
            d.write(source, 1)
        fixtures[codec] = mem.read()
# A valid TIFF can point to a directory at EOF, while data/tag payloads stay at
# their original absolute offsets. This reproduces the SIAPRESP metadata layout.
original = fixtures["DEFLATE"]
order = "little" if original[:2] == b"II" else "big"
offset = int.from_bytes(original[4:8], order)
count = int.from_bytes(original[offset : offset + 2], order)
directory = original[offset : offset + 2 + 12 * count + 4]
relocated = bytearray(original + b"\0" * 300000)
new_offset = len(relocated)
relocated.extend(directory)
relocated[4:8] = new_offset.to_bytes(4, order)
fixtures["DEFLATE_LATE_IFD"] = bytes(relocated)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/api/catalog*", lambda r: r.fulfill(json={"items": [], "updated": 1}))
    page.route(
        "**/api/config",
        lambda r: r.fulfill(json={"hosted": False, "googleMapsKey": ""}),
    )

    def read(r):
        q = parse_qs(urlparse(r.request.url).query)
        b = fixtures[q["key"][0]]
        a, z = int(q["start"][0]), int(q["end"][0])
        assert z - a + 1 <= 262144
        r.fulfill(body=b[a : z + 1], content_type="application/octet-stream")

    page.route("**/api/range?*", read)
    page.goto("http://127.0.0.1:8765")
    page.locator("#message").filter(has_text="Não há arquivos").wait_for(timeout=20000)
    for codec, b in fixtures.items():
        item = {
            "module": "ste",
            "key": codec,
            "bytes": len(b),
            "etag": "fixture",
            "product": "adequabilidade",
        }
        result = page.evaluate(
            "async item=>{const p=await OcculusRaster.preview(item,96);return {stats:p.sampleStats,shape:p.size}}",
            item,
        )
        stats = result["stats"]
        assert stats["finite"] == 4095 and stats["total"] == 4096
        assert abs(stats["min"]) < 1e-7 and abs(stats["max"] - 1) < 1e-7
        for point in stats["checkSamples"]:
            assert (
                abs(point["value"] - float(source[point["row"], point["column"]]))
                < 1e-7
            )
        print(codec, "decoded and checked:", result, flush=True)
    # Different modules use different scientific display scales.
    colors = page.evaluate(
        '()=>({index:Array.from(OcculusRaster.color(new Float64Array([0]),1,"NDCI","phytobloom")),prediction:Array.from(OcculusRaster.color(new Float64Array([0]),1,"adequabilidade","ste"))})'
    )
    assert colors["index"] != colors["prediction"]
    assert not errors, errors
    browser.close()
