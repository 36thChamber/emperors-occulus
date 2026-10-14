import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = process.cwd(),
  dir = path.join(root, "occulus/static"),
  assets = {};
function walk(base, prefix = "/static/") {
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, e.name);
    if (e.isDirectory()) walk(full, prefix + e.name + "/");
    else if (!e.name.endsWith(".ico")) {
      const ext = path.extname(e.name),
        type = {
          ".js": "text/javascript",
          ".css": "text/css",
          ".html": "text/html",
          ".svg": "image/svg+xml",
        }[ext];
      if (type)
        assets[prefix + e.name] = { body: fs.readFileSync(full, "utf8"), type };
    }
  }
}
walk(dir);
assets["/"] = {
  body: fs
    .readFileSync(path.join(dir, "index.html"), "utf8")
    .replace("__TOKEN__", ""),
  type: "text/html",
};
const revision = createHash("sha256")
  .update(JSON.stringify(assets))
  .digest("hex")
  .slice(0, 12);
assets["/"].body = assets["/"].body.replace(
  /((?:src|href)="\/static\/[^"?]+)(")/g,
  `$1?v=${revision}$2`,
);
const schema = fs.readFileSync("occulus/static/modules.js", "utf8");
const api =
  schema +
  "\n" +
  fs
    .readFileSync("hosted/worker/api.js", "utf8")
    .replace("export async function api", "async function api");
const worker =
  api +
  "\nconst assets=" +
  JSON.stringify(assets) +
  ";\n" +
  `export default { async fetch(request,env,ctx){try{const url=new URL(request.url);if(url.pathname.startsWith('/api/')||url.pathname==='/health'){const r=await api(request,env);r.headers.set('Cache-Control','no-store');r.headers.set('X-Content-Type-Options','nosniff');return r;}const asset=assets[url.pathname];if(asset)return new Response(asset.body,{headers:{'Content-Type':asset.type+'; charset=utf-8','Cache-Control':url.pathname==='/'?'no-store':'private, max-age=86400','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});return new Response('Not found',{status:404});}catch(e){return Response.json({error:e.message},{status:502,headers:{'Cache-Control':'no-store'}})}}};`;
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist/server", { recursive: true });
fs.mkdirSync("dist/.openai", { recursive: true });
fs.writeFileSync("dist/server/index.js", worker);
fs.copyFileSync(".openai/hosting.json", "dist/.openai/hosting.json");
console.log(
  "Worker built: " +
    worker.length +
    " bytes; " +
    Object.keys(assets).length +
    " assets.",
);
