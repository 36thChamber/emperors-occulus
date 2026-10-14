const enc = new TextEncoder();
const KEY = /^\d+_\d{4}_\d{2}_\d{2}_(?:NDCI|NDVI2?|RGB(?:_MASK)?)\.tif$/;
let catalogCache = null;
const hex = (b) =>
  Array.from(new Uint8Array(b))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
const hash = async (s) =>
  hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(key, data) {
  const k = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
async function signed(env, key = "", query = {}, range = null) {
  const region = env.AWS_REGION || "sa-east-1",
    bucket = env.S3_BUCKET || "copel-siapesq";
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY)
    throw Error("Credencial de leitura não configurada.");
  const hostname = `${bucket}.s3.${region}.amazonaws.com`,
    path = "/" + key.split("/").map(encodeURIComponent).join("/");
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  const dt = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""),
    date = dt.slice(0, 8),
    payload = "UNSIGNED-PAYLOAD";
  const values = {
    host: hostname,
    "x-amz-content-sha256": payload,
    "x-amz-date": dt,
  };
  if (range) values.range = range;
  const names = Object.keys(values).sort(),
    headers = names.map((k) => `${k}:${values[k]}\n`).join(""),
    scope = `${date}/${region}/s3/aws4_request`;
  const canonical = `GET\n${path}\n${qs}\n${headers}\n${names.join(";")}\n${payload}`;
  let k = await hmac("AWS4" + env.AWS_SECRET_ACCESS_KEY, date);
  k = await hmac(k, region);
  k = await hmac(k, "s3");
  k = await hmac(k, "aws4_request");
  const signature = hex(
    await hmac(
      k,
      `AWS4-HMAC-SHA256\n${dt}\n${scope}\n${await hash(canonical)}`,
    ),
  );
  const auth = `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const out = await fetch(`https://${hostname}${path}${qs ? "?" + qs : ""}`, {
    headers: { ...values, Authorization: auth },
  });
  if (!out.ok) throw Error(`S3 retornou ${out.status}.`);
  return out;
}
function xml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function tag(s, n) {
  return xml(s.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1] || "");
}
export async function api(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/health")
    return Response.json({ app: "emperors-occulus", status: "ok" });
  if (url.pathname === "/api/config")
    return Response.json({
      googleMapsKey: env.GOOGLE_MAPS_API_KEY || "",
      hosted: true,
    });
  if (url.pathname === "/api/catalog") {
    if (
      !catalogCache ||
      Date.now() - catalogCache.at > 600000 ||
      (url.searchParams.get("refresh") === "1" &&
        Date.now() - catalogCache.at > 60000)
    ) {
      let items = [],
        cursor = "";
      do {
        const query = { "list-type": "2", "max-keys": "1000" };
        if (cursor) query["continuation-token"] = cursor;
        const text = await (await signed(env, "", query)).text();
        for (const block of text.matchAll(
          /<Contents>([\s\S]*?)<\/Contents>/g,
        )) {
          const key = tag(block[1], "Key");
          if (!KEY.test(key)) continue;
          const m = key.match(/^(\d+)_(\d{4})_(\d{2})_(\d{2})_(.+)\.tif$/);
          items.push({
            key,
            area: m[1],
            date: `${m[2]}-${m[3]}-${m[4]}`,
            product: m[5],
            bytes: Number(tag(block[1], "Size")),
            etag: tag(block[1], "ETag"),
            published: tag(block[1], "LastModified"),
          });
        }
        cursor = tag(text, "NextContinuationToken");
      } while (cursor);
      catalogCache = {
        at: Date.now(),
        data: {
          items,
          updated: Date.now() / 1000,
          bucket: env.S3_BUCKET || "copel-siapesq",
        },
      };
    }
    return Response.json(catalogCache.data);
  }
  if (url.pathname === "/api/range") {
    const key = url.searchParams.get("key"),
      start = Number(url.searchParams.get("start")),
      end = Number(url.searchParams.get("end"));
    if (
      !KEY.test(key || "") ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end - start + 1 > 262144
    )
      return Response.json({ error: "Intervalo inválido." }, { status: 400 });
    const r = await signed(env, key, {}, `bytes=${start}-${end}`);
    if (r.status !== 206)
      return Response.json(
        { error: "O S3 não devolveu uma leitura parcial." },
        { status: 502 },
      );
    const etag = url.searchParams.get("etag");
    if (etag && r.headers.get("etag") !== etag)
      return Response.json(
        { error: "O arquivo mudou. Atualize o catálogo." },
        { status: 409 },
      );
    return new Response(r.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Length": r.headers.get("content-length"),
      },
    });
  }
  return Response.json({ error: "Rota não encontrada." }, { status: 404 });
}
