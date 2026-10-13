const $ = (id) => document.getElementById(id),
  token = document.querySelector("meta[name=occulus-token]").content;
let items = [],
  crop = [0, 0, 1, 1],
  transferred = 0,
  busy = false;
const fmt = (b) =>
  b >= 1048576
    ? (b / 1048576).toFixed(2) + " MiB"
    : (b / 1024).toFixed(1) + " KiB";
const day = (d) => d.split("-").reverse().join("/");
function msg(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
async function api(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    headers: { "X-Occulus-Token": token, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok)
    throw Error(j.error || "Não foi possível consultar o serviço local.");
  return j;
}
function options(el, values, placeholder) {
  el.replaceChildren();
  if (placeholder) el.add(new Option(placeholder, ""));
  values.forEach(([value, label]) => el.add(new Option(label, value)));
}
function dates() {
  const area = $("area").value,
    product = $("product").value,
    old = $("date").value;
  const ds = [
    ...new Set(
      items
        .filter((x) => x.area === area && x.product === product)
        .map((x) => x.date),
    ),
  ]
    .sort()
    .reverse();
  options(
    $("date"),
    ds.map((d) => [d, day(d)]),
  );
  if (ds.includes(old)) $("date").value = old;
  options(
    $("compare"),
    ds.map((d) => [d, day(d)]),
    "Sem comparação",
  );
  invalidate();
  $("load").disabled = !ds.length;
  msg(
    ds.length
      ? "Escolha Visualizar para consultar a imagem."
      : "Não há arquivos deste produto para esta área.",
  );
}
function invalidate() {
  crop = [0, 0, 1, 1];
  $("image-a").hidden = true;
  $("image-a").removeAttribute("src");
  $("empty-a").hidden = false;
  $("image-b").removeAttribute("src");
  $("panel-b").hidden = true;
  $("viewers").classList.remove("comparing");
  $("zoom").disabled = $("reset").disabled = true;
  $("title-a").textContent = "Escolha uma análise";
  $("size-a").textContent = "";
  $("info-a").textContent = "Nenhuma imagem carregada.";
  $("crop-status").textContent = "Recorte completo";
}
async function catalog(refresh = false) {
  $("refresh").disabled = true;
  msg("Consultando apenas os nomes e datas dos arquivos…");
  try {
    const old = $("area").value;
    const j = await api("/api/catalog" + (refresh ? "?refresh=1" : ""));
    items = j.items;
    const areas = [...new Set(items.map((x) => x.area))].sort(
      (a, b) => Number(a) - Number(b),
    );
    options(
      $("area"),
      areas.map((a) => [a, "Área " + a]),
    );
    if (areas.includes(old)) $("area").value = old;
    else if (areas.includes("165")) $("area").value = "165";
    $("areas-count").textContent = areas.length;
    $("dates-count").textContent = new Set(items.map((x) => x.date)).size;
    $("latest").textContent = items.length
      ? day(
          items
            .map((x) => x.date)
            .sort()
            .at(-1),
        )
      : "—";
    $("catalog-status").textContent =
      items.length +
      " arquivos · " +
      new Date(j.updated * 1000).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    dates();
  } catch (e) {
    msg(e.message, true);
  } finally {
    $("refresh").disabled = false;
  }
}
function setBusy(v) {
  busy = v;
  for (const id of [
    "area",
    "date",
    "product",
    "compare",
    "quality",
    "load",
    "refresh",
    "zoom",
    "reset",
  ])
    $(id).disabled = v;
}
async function render(date, slot) {
  const item = items.find(
    (x) =>
      x.area === $("area").value &&
      x.product === $("product").value &&
      x.date === date,
  );
  if (!item) throw Error("Arquivo indisponível para esta seleção.");
  const j = await api("/api/preview", {
    method: "POST",
    body: JSON.stringify({
      key: item.key,
      resolution: Number($("quality").value),
      crop,
    }),
  });
  const m = j.metadata;
  transferred += m.transferred;
  $("transfer").textContent = fmt(transferred);
  $("image-" + slot).src = "data:image/png;base64," + j.image;
  $("image-" + slot).hidden = false;
  $("title-" + slot).textContent =
    "Área " + item.area + " · " + item.product + " · " + day(date);
  $("size-" + slot).textContent = fmt(item.bytes) + " original";
  $("info-" + slot).textContent =
    m.previewWidth +
    " × " +
    m.previewHeight +
    " amostras · " +
    (m.cached ? "Reutilizada da memória" : fmt(m.transferred) + " lidos") +
    (m.epsg ? " · EPSG:" + m.epsg : "");
  return m;
}
async function load() {
  if (busy) return;
  setBusy(true);
  msg("Lendo amostras da imagem. Isso pode levar alguns segundos…");
  try {
    await render($("date").value, "a");
    $("empty-a").hidden = true;
    const compare = $("compare").value;
    $("panel-b").hidden = !compare;
    $("viewers").classList.toggle("comparing", !!compare);
    if (compare) await render(compare, "b");
    $("legend").hidden = $("product").value.startsWith("RGB");
    $("crop-status").textContent =
      crop[2] - crop[0] > 0.999
        ? "Recorte completo"
        : "Ampliação " + (1 / (crop[2] - crop[0])).toFixed(1) + "×";
    msg("Prévia pronta. Os valores não são uma classificação de risco.");
  } catch (e) {
    msg(e.message, true);
  } finally {
    setBusy(false);
    const loaded = !$("image-a").hidden;
    $("zoom").disabled = $("reset").disabled = !loaded;
  }
}
function zoom(cx = 0.5, cy = 0.5) {
  if (busy || $("image-a").hidden) return;
  const w = crop[2] - crop[0],
    h = crop[3] - crop[1];
  if (w < 1 / 64) return;
  const nx = Math.max(0, Math.min(1 - w / 2, crop[0] + cx * w - w / 4)),
    ny = Math.max(0, Math.min(1 - h / 2, crop[1] + cy * h - h / 4));
  crop = [nx, ny, nx + w / 2, ny + h / 2];
  load();
}
$("refresh").onclick = () => catalog(true);
$("area").onchange = dates;
$("product").onchange = dates;
$("date").onchange = () => {
  invalidate();
  msg("Seleção alterada. Clique em Visualizar.");
};
$("compare").onchange = () => {
  invalidate();
  msg("Clique em Visualizar para carregar a comparação.");
};
$("load").onclick = load;
$("zoom").onclick = () => zoom();
$("reset").onclick = () => {
  crop = [0, 0, 1, 1];
  load();
};
$("image-a").ondblclick = (e) => {
  const r = e.target.getBoundingClientRect(),
    scale = Math.min(
      r.width / e.target.naturalWidth,
      r.height / e.target.naturalHeight,
    ),
    w = e.target.naturalWidth * scale,
    h = e.target.naturalHeight * scale,
    x = (e.clientX - r.left - (r.width - w) / 2) / w,
    y = (e.clientY - r.top - (r.height - h) / 2) / h;
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) zoom(x, y);
};
catalog();
