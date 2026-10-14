import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source = fs.readFileSync("dist/server/index.js", "utf8"),
  worker = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
test("worker serves the actual map interface and local dependencies", async () => {
  const r = await worker.default.fetch(
    new Request("https://example.test/"),
    {},
    {},
  );
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /id="map"/);
  assert.match(html, /Machine Spirit/);
  assert(!html.includes("__TOKEN__"));
  const js = await worker.default.fetch(
    new Request("https://example.test/static/raster.js"),
    {},
    {},
  );
  assert.equal(js.status, 200);
  assert.match(await js.text(), /cropForBounds/);
});
test("invalid ranges and paths rejected before contacting S3", async () => {
  for (const query of [
    "key=../../private&start=0&end=20",
    "key=165_2026_10_09_NDCI.tif&start=0&end=999999",
    "key=165_2026_10_09_NDCI.tif&start=-2&end=2",
  ]) {
    const r = await worker.default.fetch(
      new Request("https://example.test/api/range?" + query),
      {},
      {},
    );
    assert.equal(r.status, 400);
  }
});
test("AWS signing uses bounded ranges and rejects changed versions", async () => {
  const orig = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(new Uint8Array(16), {
      status: 206,
      headers: { etag: '"new"', "content-length": "16" },
    });
  };
  try {
    const env = { AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" };
    const r = await worker.default.fetch(
      new Request(
        "https://example.test/api/range?key=165_2026_10_09_NDCI.tif&start=0&end=15&etag=%22old%22",
      ),
      env,
      {},
    );
    assert.equal(r.status, 409);
    assert.equal(captured.options.headers.range, "bytes=0-15");
    assert.match(captured.options.headers.Authorization, /AWS4-HMAC-SHA256/);
    assert.equal(
      new URL(captured.url).hostname,
      "copel-siapesq.s3.sa-east-1.amazonaws.com",
    );
  } finally {
    globalThis.fetch = orig;
  }
});
