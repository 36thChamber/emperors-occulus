/* Occurrence-only data contract, shared by the browser and hosted reader. */
(function (root) {
  const normalize = (value) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const aliases = { Alouatta_caraya: 'caraya', Alouatta_guariba: 'guariba', Sapajus_nigritus: 'nigritus', Primatas_grupo: 'aranha' };
  function sourceFor(area, objects) {
    const alias = aliases[area];
    const fixed = alias && objects.find(x => x.key === `species-table/${alias}.csv`);
    if (fixed) return fixed;
    // The entire filename must match this species; never accept arbitrary keys.
    const escaped = area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^species-table/Occurrence_${escaped}_(\\d{2})_(\\d{2})_(\\d{2})( \\(\\d+\\))?\\.csv$`, 'i');
    return objects.map(x => ({ ...x, match: x.key.match(pattern) })).filter(x => x.match).sort((a,b) => {
      const stamp = x => x.match[3] + x.match[2] + x.match[1];
      return stamp(b).localeCompare(stamp(a)) || Number(!!a.match[4]) - Number(!!b.match[4]) || a.key.localeCompare(b.key);
    })[0] || null;
  }
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const result = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i+1] === '"') { field += '"'; i++; }
        else if (!quoted && field.length) field += c;
        else quoted = !quoted;
      } else if (!quoted && c === delimiter) { row.push(field); field = ''; }
      else if (!quoted && (c === '\n' || c === '\r')) {
        if (c === '\r' && text[i+1] === '\n') i++;
        row.push(field); if (row.some(x => x.trim())) result.push(row); row = []; field = '';
      } else field += c;
    }
    if (quoted) throw Error('CSV inválido: aspas não fechadas.');
    row.push(field); if (row.some(x => x.trim())) result.push(row);
    return result;
  }
  const num = value => String(value ?? '').trim() === '' ? NaN : Number(String(value).trim().replace(',', '.'));
  function prepare(text, source) {
    const parsed = parseCSV(text), columns = parsed.shift() || [], names = columns.map(normalize);
    if (!columns.length) throw Error('Tabela vazia.');
    const index = (...keys) => names.findIndex(x => keys.includes(x));
    const latIndex = index('decimallatitude', 'latitude', 'lat'), lonIndex = index('decimallongitude', 'longitude', 'lon', 'lng');
    if (latIndex < 0 || lonIndex < 0) throw Error('Tabela sem colunas de latitude/longitude reconhecidas.');
    const classIndex = index('sp', 'presence', 'presence_absence', 'presenca', 'pa');
    const statusIndices = names.map((n,i) => ['registro','occurrencestatus','occurrence_status','record_type','tipo_registro'].includes(n) ? i : -1).filter(i => i >= 0);
    const absent = value => /ausen|absen|pseudo|background/.test(normalize(value));
    const positive = value => ['present','presence','presente','presenca','occurrence','ocorrencia','observed'].includes(normalize(value));
    const occurrenceFile = /(?:^|\/)(?:Occurrence_[^/]+|[^/]+_occurrences)\.csv$/i.test(source);
    const stats = { total: parsed.length, presences: 0, excluded: 0, invalidCoordinates: 0, malformed: 0 };
    const rows = [], coordinates = [];
    for (const row of parsed) {
      if (row.length !== columns.length) { stats.malformed++; continue; }
      const statuses = statusIndices.map(i => row[i]);
      const isPresence = !statuses.some(absent) && (classIndex >= 0 ? num(row[classIndex]) === 1 : statuses.length ? statuses.some(positive) : occurrenceFile);
      if (!isPresence) { stats.excluded++; continue; }
      const lat = num(row[latIndex]), lon = num(row[lonIndex]);
      const coordinate = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
      if (!coordinate) stats.invalidCoordinates++;
      rows.push(row); coordinates.push(coordinate);
    }
    stats.presences = rows.length;
    return { columns, rows, coordinates, latIndex, lonIndex, stats };
  }
  root.OcculusOccurrences = { sourceFor, parseCSV, prepare };
})(globalThis);
