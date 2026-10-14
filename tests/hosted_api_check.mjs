import fs from "node:fs";
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.includes("\n")) break;
}
const env = JSON.parse(input),
  source = fs.readFileSync("dist/server/index.js", "utf8"),
  worker = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
const catalog = await worker.default.fetch(
    new Request("https://example.test/api/catalog"),
    env,
    {},
  ),
  data = await catalog.json();
if (catalog.status !== 200 || !data.items?.length)
  throw Error("Catalog failed: " + JSON.stringify(data));
const item = data.items.find((x) => x.key === "165_2026_10_09_NDCI.tif");
if (!item) throw Error("Known fixture missing.");
const q = new URLSearchParams({
  key: item.key,
  start: "0",
  end: "15",
  etag: item.etag,
});
const result = await worker.default.fetch(
  new Request("https://example.test/api/range?" + q),
  env,
  {},
);
if (
  result.status !== 200 ||
  Number(result.headers.get("content-length")) !== 16
)
  throw Error("Range failed: " + (await result.text()));
console.log(
  JSON.stringify({
    catalogItems: data.items.length,
    rangeBytes: (await result.arrayBuffer()).byteLength,
    awsSigning: "verified",
  }),
);
