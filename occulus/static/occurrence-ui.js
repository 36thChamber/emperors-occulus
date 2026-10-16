/* In-memory occurrence table and Canvas map layer; no persistent data storage. */
(function () {
  const cache = new Map();
  let dataset = null, identity = '', revision = 0, pending = null, abort = null, layer = null, page = 0, matches = [], pointRevision = 0;
  const pageSize = 40;
  const selectedItem = () => subset().find(x => x.product === $('product').value && x.date === $('date').value);
  const currentIdentity = () => activeModule() + ':' + $('area').value;
  const cell = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  function hidePoints() {
    pointRevision++;
    if (layer) map.removeLayer(layer);
    layer = null;
    $('show-points').setAttribute('aria-pressed', 'false');
    $('show-points').textContent = '◎ Plotar ocorrências';
    $('points-badge').hidden = true;
  }
  function closeTable() {
    $('occurrence-panel').hidden = true;
    $('show-table').setAttribute('aria-expanded', 'false');
    $('show-table').textContent = '▤ Mostrar tabela';
  }
  function sync(force = false) {
    const next = currentIdentity();
    $('occurrence-controls').hidden = activeModule() === 'phytobloom';
    $('show-table').disabled = $('show-points').disabled = !selectedItem() || activeModule() === 'phytobloom';
    if (!force && identity === next) return;
    identity = next; revision++; abort?.abort(); pending = null; dataset = null; hidePoints(); closeTable();
    $('fit-points').disabled = true;
    $('show-table').disabled = $('show-points').disabled = !selectedItem() || activeModule() === 'phytobloom';
    $('occurrence-status').textContent = 'Carregue a tabela ou os pontos da espécie selecionada.';
    $('occurrence-search').value = ''; page = 0;
    $('occurrence-table').querySelector('thead').replaceChildren();
    $('occurrence-table').querySelector('tbody').replaceChildren();
  }
  async function load() {
    if (dataset) return dataset;
    if (pending) return pending;
    const item = selectedItem();
    if (!item) throw Error('Selecione uma espécie com produtos disponíveis.');
    const id = revision, cacheKey = identity;
    abort = new AbortController();
    $('occurrence-status').textContent = 'Lendo registros e removendo pseudoausências…';
    pending = (async () => {
      let data = cache.get(cacheKey);
      if (data && Date.now() - data.at > 600000) { cache.delete(cacheKey); data = null; }
      if (!data) {
        const response = await fetch('/api/occurrences?' + new URLSearchParams({ module: activeModule(), key: item.key }), { headers: window.occulusHeaders(), signal: abort.signal, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Não foi possível carregar a tabela.');
        data = { ...OcculusOccurrences.prepare(result.text, result.source), source: result.source, etag: result.etag, at: Date.now() };
        if (id !== revision) return null;
        // Bound retained species, and refresh data on explicit catalog synchronization.
        if (cache.size >= 3) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, data);
      }
      if (id !== revision) return null;
      dataset = data;
      $('fit-points').disabled = !data.coordinates.some(Boolean);
      const s = data.stats;
      $('occurrence-status').textContent = `${s.presences.toLocaleString('pt-BR')} presenças · ${s.excluded.toLocaleString('pt-BR')} ausências/indefinidos excluídos · ${s.invalidCoordinates} sem coordenada válida` + (s.malformed ? ` · ${s.malformed} linhas inválidas` : '');
      return data;
    })();
    try { return await pending; }
    finally { if (id === revision) pending = null; }
  }
  function drawTable() {
    if (!dataset) return;
    const query = $('occurrence-search').value.trim().toLocaleLowerCase('pt-BR');
    matches = dataset.rows.map((row,i) => i).filter(i => !query || dataset.rows[i].some(v => v.toLocaleLowerCase('pt-BR').includes(query)));
    const maxPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
    page = Math.min(page, maxPage);
    const table = $('occurrence-table'), head = document.createElement('tr');
    dataset.columns.forEach(name => head.append(cell('th', name)));
    table.querySelector('thead').replaceChildren(head);
    const fragment = document.createDocumentFragment();
    for (const index of matches.slice(page * pageSize, (page + 1) * pageSize)) {
      const row = document.createElement('tr');
      dataset.rows[index].forEach(value => { const td = cell('td', value); td.title = value; row.append(td); });
      fragment.append(row);
    }
    if (!matches.length) { const row = document.createElement('tr'), td = cell('td', 'Nenhuma ocorrência para esta busca.'); td.colSpan = dataset.columns.length; row.append(td); fragment.append(row); }
    table.querySelector('tbody').replaceChildren(fragment);
    $('table-page').textContent = `${matches.length.toLocaleString('pt-BR')} registros · página ${page + 1}/${maxPage + 1}`;
    $('table-prev').disabled = page === 0;
    $('table-next').disabled = page === maxPage;
    $('table-species').textContent = modules.areaLabel($('area').value, activeModule());
    $('table-source').textContent = `Fonte: ${dataset.source} · somente presenças · registros históricos de toda a tabela`;
  }
  function popup(data, index) {
    const box = document.createElement('div');
    box.append(cell('strong', modules.areaLabel($('area').value, activeModule())));
    const coordinate = data.coordinates[index];
    box.append(cell('p', coordinate.map(x => x.toFixed(5)).join(', ')));
    const fields = ['data','eventDate','species','especie_origem','origem_registro','municipality','stateProvince','provider'];
    for (const name of fields) {
      const i = data.columns.indexOf(name);
      if (i >= 0 && data.rows[index][i]) box.append(cell('p', `${name}: ${data.rows[index][i]}`));
    }
    return box;
  }
  async function plot(data) {
    hidePoints();
    const token = ++pointRevision, id = revision;
    layer = L.layerGroup().addTo(map);
    const renderer = pointRenderer;
    $('show-points').setAttribute('aria-pressed', 'true');
    $('show-points').textContent = '◎ Ocultar ocorrências';
    let count = 0;
    for (let i = 0; i < data.rows.length; i++) {
      if (token !== pointRevision || id !== revision) return;
      if (data.coordinates[i]) {
        const marker = L.circleMarker(data.coordinates[i], { renderer, pane: 'occurrences', radius: 4, weight: 1, color: '#b7ffca', fillColor: '#38ef76', fillOpacity: 0.7 });
        marker.bindPopup(() => popup(data, i), { className: 'occurrence-popup', maxWidth: 290 });
        marker.addTo(layer); count++;
      }
      if (i && i % 400 === 0) await new Promise(requestAnimationFrame);
    }
    $('points-count').textContent = count.toLocaleString('pt-BR') + ' pontos';
    $('points-badge').hidden = false;
    $('occurrence-status').textContent += ' · Pontos sobrepostos podem compartilhar a mesma posição.';
  }
  async function action(fn) {
    const id = revision;
    try { const data = await load(); if (data && id === revision) await fn(data); }
    catch (error) { if (id === revision && error.name !== 'AbortError') $('occurrence-status').textContent = error.message; }
  }
  map.createPane('occurrences'); map.getPane('occurrences').style.zIndex = 450;
  const pointRenderer = L.canvas({ padding: 0.3, pane: 'occurrences' });
  $('show-table').onclick = () => {
    if (!$('occurrence-panel').hidden) { closeTable(); return; }
    action(() => { drawTable(); $('occurrence-panel').hidden = false; $('show-table').setAttribute('aria-expanded', 'true'); $('show-table').textContent = '▤ Ocultar tabela'; });
  };
  $('close-table').onclick = closeTable;
  $('show-points').onclick = () => { if (layer) hidePoints(); else action(plot); };
  $('fit-points').onclick = () => { if (dataset) { const coords = dataset.coordinates.filter(Boolean); if (coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [35,35], maxZoom: 13 }); } };
  $('occurrence-search').oninput = () => { page = 0; drawTable(); };
  $('table-prev').onclick = () => { page--; drawTable(); };
  $('table-next').onclick = () => { page++; drawTable(); };
  L.DomEvent.disableClickPropagation($('occurrence-panel'));
  L.DomEvent.disableScrollPropagation($('occurrence-panel'));
  function sidebar(open) {
    document.querySelector('.workspace').classList.toggle('sidebar-hidden', !open);
    $('sidebar-toggle').setAttribute('aria-expanded', String(open));
    $('sidebar-toggle').textContent = open ? '☰ Ocultar' : '☰ Controles';
    if (!open && document.activeElement?.closest('#vision-sidebar')) $('sidebar-toggle').focus();
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }
  $('sidebar-toggle').onclick = () => sidebar($('sidebar-toggle').getAttribute('aria-expanded') !== 'true');
  $('sidebar-close').onclick = () => sidebar(false);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('occurrence-panel').hidden) { closeTable(); $('show-table').focus(); } });
  sidebar(!matchMedia('(max-width: 600px)').matches);
  window.OcculusOccurrenceUI = { sync, resetCache: () => { cache.clear(); sync(true); } };
})();
