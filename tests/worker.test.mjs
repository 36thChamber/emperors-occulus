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

test("module schemas preserve canonical aranha, batches and dated ocean products", () => {
  const parse = globalThis.OcculusModules.parse;
  assert.equal(
    parse(
      "ste",
      "predictions/aranha/Primatas_grupo_rs_250m_futuro_2100_ssp585_incerteza.tif",
    ).area,
    "Primatas_grupo",
  );
  assert.equal(
    parse(
      "ste",
      "predictions/primatas_grupo/Primatas_grupo_rs_250m_futuro_2100_ssp585_incerteza.tif",
    ),
    null,
  );
  assert.equal(parse("ste", "predictions/aranha/aranha.tif"), null);
  const batch =
    "predicoes_cenarios/rs-es-2026-09-28/Turdus_rufiventris/anual_2015_2024/Turdus_rufiventris_anual_2015_2024_adequabilidade.tif";
  assert.equal(parse("ste", batch).region, "lote:rs-es-2026-09-28");
  assert.equal(
    parse("ste", batch.replace("Turdus_rufiventris_anual", "Other_anual")),
    null,
  );
  const daily =
    "predictions/daily/2026-10-12/camarao/camarao_rf_2026-10-12_mean.tif";
  assert.equal(parse("siapresp", daily).product, "mean");
  assert.equal(
    parse("siapresp", daily.replace("/camarao_rf", "/other_rf")),
    null,
  );
  assert.equal(parse("ste", daily), null);
});

test("range endpoints fix the bucket by module and reject cross-module keys", async () => {
  const orig = globalThis.fetch;
  let target;
  globalThis.fetch = async (url, opts) => {
    target = new URL(url).hostname;
    return new Response(new Uint8Array(16), {
      status: 206,
      headers: { "content-length": "16" },
    });
  };
  const env = { AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" };
  try {
    for (const [module, key, bucket] of [
      [
        "ste",
        "predictions/caraya/Alouatta_caraya_rs_250m_anual_2015_2024_adequabilidade.tif",
        "ste-siapesq",
      ],
      [
        "siapresp",
        "predictions/daily/2026-10-12/camarao/camarao_rf_2026-10-12_sd.tif",
        "tifs-siapesq",
      ],
    ]) {
      const q = new URLSearchParams({
        module,
        key,
        start: "0",
        end: "15",
        bucket: "unauthorized-bucket",
      });
      const r = await worker.default.fetch(
        new Request("https://example.test/api/range?" + q),
        env,
        {},
      );
      assert.equal(r.status, 200);
      assert.equal(target, `${bucket}.s3.sa-east-1.amazonaws.com`);
      q.set("module", "phytobloom");
      assert.equal(
        (
          await worker.default.fetch(
            new Request("https://example.test/api/range?" + q),
            env,
            {},
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await worker.default.fetch(
          new Request("https://example.test/api/catalog?module=other"),
          env,
          {},
        )
      ).status,
      400,
    );
  } finally {
    globalThis.fetch = orig;
  }
});
