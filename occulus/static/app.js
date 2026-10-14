const $ = (id) => document.getElementById(id),
  rawToken = document.querySelector("meta[name=occulus-token]").content;
window.occulusHeaders = () =>
  rawToken && rawToken !== "__TOKEN__" ? { "X-Occulus-Token": rawToken } : {};
let items = [],
  overlayA = null,
  overlayB = null,
  selection = null,
  generation = 0,
  controller = null,
  refineTimer = null,
  currentCrop = [0, 0, 1, 1],
  googleLayer = null,
  googleSatelliteLayer = null;
const modules = OcculusModules;
const activeModule = () => $("module").value;
const subset = () =>
  items.filter(
    (x) =>
      x.area === $("area").value &&
      (activeModule() !== "ste" || x.region === $("region").value),
  );
let catalogGeneration = 0;
const fmt = (b) =>
    b >= 1048576
      ? (b / 1048576).toFixed(2) + " MiB"
      : (b / 1024).toFixed(1) + " KiB",
  day = (d) => modules.scenarioLabel(d);
const map = L.map("map", {
  zoomControl: true,
  maxZoom: 22,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
}).setView([-18.5, -47], 5);
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxNativeZoom: 19,
  maxZoom: 22,
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
}).addTo(map);
function msg(t, error = false) {
  $("message").textContent = t;
  $("message").classList.toggle("error", error);
}
async function api(path) {
  const r = await fetch(path, {
    headers: window.occulusHeaders(),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Falha de comunicação com o cogitador.");
  return j;
}
function options(el, values, placeholder) {
  el.replaceChildren();
  if (placeholder) el.add(new Option(placeholder, ""));
  values.forEach(([v, l]) => el.add(new Option(l, v)));
}
function removeLayers() {
  generation++;
  controller?.abort();
  clearTimeout(refineTimer);
  if (overlayA) map.removeLayer(overlayA);
  if (overlayB) map.removeLayer(overlayB);
  overlayA = overlayB = null;
  selection = null;
  $("load").disabled = false;
  $("fit").disabled = true;
  $("comparison").hidden = true;
  $("map-title").textContent = "AUSPEX EM ESPERA";
  $("map-subtitle").textContent =
    "Selecione Invocar visão para carregar a análise.";
}
function dates() {
  const area = $("area").value,
    product = $("product").value,
    old = $("date").value,
    ds = [
      ...new Set(
        subset()
          .filter((x) => x.product === product)
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
  else if (activeModule() === "ste" && ds.includes("anual_2015_2024"))
    $("date").value = "anual_2015_2024";
  options(
    $("compare"),
    ds.map((d) => [d, day(d)]),
    "Sem comparação",
  );
  removeLayers();
  $("load").disabled = !ds.length;
  msg(
    ds.length
      ? "Cogitador pronto. Invoque a visão para carregar uma análise."
      : "Não há arquivos para esta seleção.",
  );
}
function products() {
  const old = $("product").value,
    available = [...new Set(subset().map((x) => x.product))];
  const order =
    activeModule() === "phytobloom"
      ? ["NDCI", "NDVI", "NDVI2", "RGB", "RGB_MASK"]
      : activeModule() === "ste"
        ? ["adequabilidade", "incerteza", "extrapolacao", "adequabilidade_R"]
        : ["mean", "sd"];
  options(
    $("product"),
    order
      .filter((p) => available.includes(p))
      .map((p) => [p, modules.productLabel(p)]),
  );
  if (available.includes(old)) $("product").value = old;
  dates();
}
function regions() {
  const module = activeModule(),
    old = $("region").value;
  $("region-control").hidden = module === "phytobloom";
  if (module === "ste") {
    const list = [
      ...new Set(
        items.filter((x) => x.area === $("area").value).map((x) => x.region),
      ),
    ]
      .sort()
      .reverse();
    options(
      $("region"),
      list.map((r) => [r, modules.regionLabel(r)]),
    );
    if (list.includes(old)) $("region").value = old;
    else if (list.includes("nacional_1km")) $("region").value = "nacional_1km";
  } else if (module === "siapresp")
    options($("region"), [
      ["atlantic", "Atlântico Sul"],
      ["integral", "Extensão integral"],
    ]);
  else options($("region"), [["", "Toda a área"]]);
  products();
}
async function catalog(refresh = false) {
  const id = ++catalogGeneration,
    module = activeModule();
  removeLayers();
  $("refresh").disabled = true;
  $("load").disabled = true;
  msg("Sincronizando " + modules.definitions[module].label + "…");
  try {
    const old = $("area").value,
      j = await api(
        "/api/catalog?module=" + module + (refresh ? "&refresh=1" : ""),
      );
    if (id !== catalogGeneration) return;
    items = j.items;
    const areas = [...new Set(items.map((x) => x.area))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    options(
      $("area"),
      areas.map((a) => [a, modules.areaLabel(a, module)]),
    );
    if (areas.includes(old)) $("area").value = old;
    else if (module === "phytobloom" && areas.includes("165"))
      $("area").value = "165";
    else if (module === "ste" && areas.includes("Alouatta_caraya"))
      $("area").value = "Alouatta_caraya";
    $("area-label").textContent =
      module === "phytobloom" ? "Área" : "Espécie / grupo";
    $("date-label").textContent =
      module === "ste" ? "Cenário" : "Data do produto";
    $("entity-label").textContent =
      module === "phytobloom" ? "ÁREAS" : "ESPÉCIES";
    $("period-label").textContent = module === "ste" ? "CENÁRIOS" : "DATAS";
    $("latest-label").textContent = module === "ste" ? "PUBLICADO" : "ÚLTIMA";
    $("module-note").textContent =
      modules.definitions[module].label.toUpperCase();
    $("areas-count").textContent = areas.length;
    $("dates-count").textContent = new Set(items.map((x) => x.date)).size;
    const stamps = items
      .map((x) => (module === "ste" ? x.published?.slice(0, 10) : x.date))
      .filter(Boolean)
      .sort();
    $("latest").textContent = stamps.length ? day(stamps.at(-1)) : "—";
    $("catalog-status").textContent =
      items.length + " produtos · " + modules.definitions[module].label;
    regions();
  } catch (e) {
    if (id === catalogGeneration) msg(e.message, true);
  } finally {
    if (id === catalogGeneration) $("refresh").disabled = false;
  }
}

function clip() {
  if (!overlayB) return;
  const el = overlayB.getElement(),
    size = map.getSize(),
    pos = map.containerPointToLayerPoint([
      (size.x * Number($("swipe").value)) / 100,
      0,
    ]),
    origin = L.DomUtil.getPosition(el);
  const x = pos.x - origin.x;
  el.style.clip = `rect(-100000px, ${x}px, 100000px, -100000px)`;
}
function apply(result, slot) {
  let layer = slot === "a" ? overlayA : overlayB;
  if (layer) map.removeLayer(layer);
  layer = L.imageOverlay(result.url, result.bounds, {
    opacity: Number($("opacity").value),
    interactive: false,
    zIndex: slot === "a" ? 10 : 11,
  }).addTo(map);
  if (slot === "a") overlayA = layer;
  else overlayB = layer;
  clip();
}
async function render(fit = false, crop = [0, 0, 1, 1]) {
  const id = ++generation;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const item = subset().find(
    (x) => x.product === $("product").value && x.date === $("date").value,
  );
  if (!item) return;
  const compare = subset().find(
    (x) =>
      x.area === item.area &&
      x.product === item.product &&
      x.date === $("compare").value,
  );
  $("load").disabled = true;
  msg("O espírito processa a visão orbital…");
  let pendingMeta = null;
  try {
    pendingMeta = await OcculusRaster.header(item, signal);
    if (
      fit &&
      activeModule() === "siapresp" &&
      $("region").value === "atlantic"
    ) {
      const meta = pendingMeta;
      crop =
        OcculusRaster.cropForBounds(
          meta,
          L.latLngBounds([
            [-40, -60],
            [7, -25],
          ]),
        ) || crop;
    }
    const result = await OcculusRaster.preview(
      item,
      Number($("quality").value),
      crop,
      signal,
    );
    if (id !== generation) return;
    apply(result, "a");
    selection = result;
    currentCrop = crop;
    $("fit").disabled = false;
    $("legend").hidden = item.product.startsWith("RGB");
    const isIndex = activeModule() === "phytobloom";
    $("legend-min").textContent = isIndex ? "−1" : "0";
    $("legend-mid").textContent = isIndex ? "0" : "0.5";
    $("legend-max").textContent = isIndex ? "+1" : "1";
    $("legend-label").textContent = isIndex
      ? "ÍNDICE / CORES ORIGINAIS"
      : modules.productLabel(item.product).toUpperCase() + " / ESCALA 0–1";
    $("map-title").textContent =
      `${modules.areaLabel(item.area, activeModule())} // ${modules.productLabel(item.product)}`;
    $("map-subtitle").textContent =
      `${day(item.date)} · EPSG:${result.meta.epsg} → mapa georreferenciado`;
    if (compare) {
      const cm = await OcculusRaster.header(compare, signal);
      const viewportBounds = L.latLngBounds(result.bounds),
        ccrop = OcculusRaster.cropForBounds(cm, viewportBounds) || [0, 0, 1, 1];
      const cr = await OcculusRaster.preview(
        compare,
        Number($("quality").value),
        ccrop,
        signal,
      );
      if (id !== generation) return;
      apply(cr, "b");
      $("comparison").hidden = false;
      $("comparison-label").textContent =
        day(compare.date) + " ↔ " + day(item.date);
    } else {
      if (overlayB) map.removeLayer(overlayB);
      overlayB = null;
      $("comparison").hidden = true;
    }
    $("read-info").textContent =
      `${result.size[0]} × ${result.size[1]} amostras · ${result.cached ? "em memória" : fmt(result.transferred) + " lidos"} · original ${fmt(item.bytes)}`;
    if (fit) {
      map.fitBounds(result.bounds, { padding: [35, 35], animate: false });
      clearTimeout(refineTimer);
    }
    msg("Visão estabelecida. Arraste e amplie o mapa para explorar.");
  } catch (e) {
    if (e.name !== "AbortError" && id === generation) {
      if (pendingMeta && e.message.includes("16 MiB") && !selection) {
        // Keep only georeferencing after a budget refusal: zoom can retry a
        // smaller viewport without first downloading the full raster.
        selection = { meta: pendingMeta };
        currentCrop = crop;
      }
      msg(e.message, true);
    }
  } finally {
    if (id === generation) $("load").disabled = false;
  }
}
function refine() {
  clip();
  if (!selection) return;
  clearTimeout(refineTimer);
  refineTimer = setTimeout(() => {
    if (!selection) return;
    const crop = OcculusRaster.cropForBounds(selection.meta, map.getBounds());
    if (!crop) return;
    // Reuse the full preview while zoomed out; refine only significant changes in visible crop.
    if (crop.every((v, i) => Math.abs(v - currentCrop[i]) < 0.025)) return;
    if (
      (crop[2] - crop[0]) * (crop[3] - crop[1]) > 0.8 &&
      currentCrop[2] - currentCrop[0] > 0.9
    )
      return;
    render(false, crop);
  }, 1000);
}
map.on("moveend", refine);
map.on("move zoom", clip);
map.on(
  "mousemove",
  (e) =>
    ($("coordinates").textContent =
      e.latlng.lat.toFixed(5) + "°, " + e.latlng.lng.toFixed(5) + "°"),
);
$("area").onchange = regions;
$("module").onchange = () => catalog();
$("region").onchange = () => {
  if (activeModule() === "ste") products();
  else {
    removeLayers();
    msg("Recorte alterado. Invoque a visão.");
  }
};
$("product").onchange = dates;
$("date").onchange = () => {
  removeLayers();
  msg("Nova data selecionada. Invoque a visão.");
};
$("compare").onchange = () => {
  if (selection) render(false, currentCrop);
};
$("load").onclick = () => render(true);
$("refresh").onclick = () => catalog(true);
$("fit").onclick = () => {
  if (selection) map.fitBounds(selection.bounds, { padding: [35, 35] });
};
$("quality").onchange = () => {
  if (selection) render(false, currentCrop);
};
$("opacity").oninput = () => {
  overlayA?.setOpacity(Number($("opacity").value));
  overlayB?.setOpacity(Number($("opacity").value));
};
$("swipe").oninput = clip;
window.addEventListener(
  "rasterbytes",
  (e) => ($("transfer").textContent = fmt(e.detail)),
);
(async () => {
  try {
    const config = await api("/api/config");
    $("mode").textContent = config.hosted
      ? "Hospedado · acesso livre"
      : "Cogitador local · somente leitura";
    if (config.googleMapsKey) {
      const script = document.createElement("script");
      script.src =
        "https://maps.googleapis.com/maps/api/js?key=" +
        encodeURIComponent(config.googleMapsKey) +
        "&loading=async";
      script.onload = () => {
        googleLayer = L.gridLayer.googleMutant({
          type: "roadmap",
          maxZoom: 22,
          styles: [
            { elementType: "geometry", stylers: [{ color: "#06140b" }] },
            {
              elementType: "labels.text.fill",
              stylers: [{ color: "#76cb92" }],
            },
            {
              elementType: "labels.text.stroke",
              stylers: [{ color: "#020904" }],
            },
            {
              featureType: "road",
              elementType: "geometry",
              stylers: [{ color: "#205a33" }],
            },
            {
              featureType: "road.highway",
              elementType: "geometry",
              stylers: [{ color: "#357e49" }],
            },
            {
              featureType: "water",
              elementType: "geometry",
              stylers: [{ color: "#010603" }],
            },
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        googleSatelliteLayer = L.gridLayer.googleMutant({
          type: "satellite",
          maxZoom: 22,
        });
        $("basemap").options[1].disabled = false;
        $("basemap").options[2].disabled = false;
      };
      document.head.append(script);
    }
  } catch (e) {
    msg(e.message, true);
  }
  catalog();
})();
$("basemap").onchange = () => {
  map.removeLayer(osm);
  if (googleLayer) map.removeLayer(googleLayer);
  if (googleSatelliteLayer) map.removeLayer(googleSatelliteLayer);
  const selected = $("basemap").value;
  $("map").classList.toggle("google-crt", selected.startsWith("google"));
  if (selected === "google" && googleLayer) googleLayer.addTo(map);
  else if (selected === "google-satellite" && googleSatelliteLayer)
    googleSatelliteLayer.addTo(map);
  else osm.addTo(map);
};
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("map-shell").requestFullscreen();
  } catch {
    msg("Este navegador não permite tela inteira. O mapa continua disponível.");
  }
};
document.addEventListener("fullscreenchange", () => {
  $("fullscreen").setAttribute(
    "aria-label",
    document.fullscreenElement
      ? "Sair da tela inteira"
      : "Ampliar mapa para tela inteira",
  );
  map.invalidateSize({ pan: false });
});
new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($("map"));
window.occulusMap = map;
