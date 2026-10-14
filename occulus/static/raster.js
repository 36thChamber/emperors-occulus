/* Sparse, uncompressed GeoTIFF sampling + explicit projection into Web Mercator.
   Raster files stay in memory; only selected row intervals are fetched. */
window.OcculusRaster = (() => {
  const headers = new Map(),
    previews = new Map();
  const palette = [
    [32, 75, 135],
    [48, 153, 179],
    [225, 235, 188],
    [246, 187, 79],
    [207, 71, 57],
  ];
  let bytes = 0;
  async function interval(item, start, end, signal) {
    end = Math.min(end, item.bytes - 1);
    const q = new URLSearchParams({
      key: item.key,
      module: item.module || "phytobloom",
      start: String(start),
      end: String(end),
      etag: item.etag,
    });
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        r = await fetch("/api/range?" + q, {
          headers: window.occulusHeaders(),
          signal,
          cache: "no-store",
        });
        if (![502, 503, 504].includes(r.status) || attempt === 2) break;
        await r.body?.cancel();
      } catch (error) {
        if (error.name === "AbortError" || attempt === 2) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
    if (!r.ok) {
      let e;
      try {
        e = await r.json();
      } catch {}
      throw Error(e?.error || "Falha na leitura parcial: " + r.status);
    }
    const b = await r.arrayBuffer();
    if (b.byteLength !== end - start + 1) throw Error("Intervalo incompleto.");
    bytes += b.byteLength;
    window.dispatchEvent(new CustomEvent("rasterbytes", { detail: bytes }));
    return b;
  }
  function projection(fd) {
    const g = fd.GeoKeyDirectory;
    if (!g) throw Error("GeoTIFF sem sistema de coordenadas.");
    let epsg = null;
    for (let i = 4; i < g.length; i += 4)
      if ([2048, 3072].includes(g[i]) && g[i + 1] === 0 && g[i + 3] !== 32767)
        epsg = g[i + 3];
    if (!epsg) throw Error("Código EPSG não identificado.");
    const name = "EPSG:" + epsg;
    if (!proj4.defs(name)) {
      if (epsg >= 32601 && epsg <= 32660)
        proj4.defs(
          name,
          `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`,
        );
      else if (epsg >= 32701 && epsg <= 32760)
        proj4.defs(
          name,
          `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`,
        );
      else throw Error("Projeção ainda não suportada: " + name);
    }
    return {
      name,
      epsg,
      toMerc: proj4(name, "EPSG:3857"),
      toGeo: proj4(name, "EPSG:4326"),
    };
  }
  async function header(item, signal) {
    const key = (item.module || "phytobloom") + item.key + item.etag;
    if (headers.has(key)) return headers.get(key);
    let headerBytes = 0,
      buffer = null;
    const client = {
      async request({ headers: requestHeaders, signal: requestSignal }) {
        const range = new Headers(requestHeaders)
          .get("Range")
          .match(/^bytes=(\d+)-(\d+)$/);
        if (!range) throw Error("Intervalo de metadados inválido.");
        const start = Number(range[1]),
          end = Math.min(Number(range[2]), item.bytes - 1),
          length = end - start + 1;
        if (length <= 0 || headerBytes + length > 2 * 1048576)
          throw Error("Metadados TIFF excedem 2 MiB.");
        headerBytes += length;
        const out = new Uint8Array(length);
        for (let i = 0; i < length; i += 262144) {
          const part = await interval(
            item,
            start + i,
            Math.min(end, start + i + 262143),
            requestSignal || signal,
          );
          out.set(new Uint8Array(part), i);
        }
        if (start === 0 && !buffer) buffer = out.buffer;
        return {
          ok: true,
          status: 206,
          getHeader(name) {
            if (name.toLowerCase() === "content-range")
              return `bytes ${start}-${end}/${item.bytes}`;
            if (name.toLowerCase() === "content-type")
              return "application/octet-stream";
            return null;
          },
          async getData() {
            return out.buffer;
          },
        };
      },
    };
    const tiff = await GeoTIFF.fromCustomClient(
        client,
        { blockSize: 65536, cacheSize: 32, allowFullFile: false },
        signal,
      ),
      image = await tiff.getImage(),
      fd = image.getFileDirectory();
    if (
      ![1, 5, 8, 32946].includes(fd.Compression || 1) ||
      ((fd.PlanarConfiguration || 1) !== 1 && (fd.SamplesPerPixel || 1) > 1) ||
      ![1, 3].includes(fd.SamplesPerPixel || 1)
    )
      throw Error(
        "Formato de TIFF ainda não compatível com leitura econômica.",
      );
    const scale = fd.ModelPixelScale,
      tie = fd.ModelTiepoint;
    if (!scale || !tie) throw Error("GeoTIFF sem transformação espacial.");
    const w = fd.ImageWidth,
      h = fd.ImageLength,
      c = fd.SamplesPerPixel || 1,
      bits = fd.BitsPerSample[0],
      format = fd.SampleFormat?.[0] || 1;
    const little = image.littleEndian;
    const origin = [tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]],
      p = projection(fd);
    const meta = {
      fd,
      w,
      h,
      c,
      bits,
      format,
      little,
      scale,
      origin,
      ...p,
      item,
      buffer,
      headerBytes,
    };
    if (
      ![8, 16, 32, 64].includes(bits) ||
      fd.BitsPerSample.some((b) => b !== bits)
    )
      throw Error("Tipo de pixel não suportado.");
    headers.set(key, meta);
    while (headers.size > 16) headers.delete(headers.keys().next().value);
    return meta;
  }
  function bounds(meta, crop) {
    const [x0, y0, x1, y1] = crop,
      pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      for (const [x, y] of [
        [x0 + (x1 - x0) * t, y0],
        [x0 + (x1 - x0) * t, y1],
        [x0, y0 + (y1 - y0) * t],
        [x1, y0 + (y1 - y0) * t],
      ])
        pts.push(
          meta.toMerc.forward([
            meta.origin[0] + x * meta.w * meta.scale[0],
            meta.origin[1] - y * meta.h * meta.scale[1],
          ]),
        );
    }
    return [
      Math.min(...pts.map((p) => p[0])),
      Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])),
      Math.max(...pts.map((p) => p[1])),
    ];
  }
  function cropForBounds(meta, b) {
    const coords = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      for (const [lng, lat] of [
        [b.getWest() + (b.getEast() - b.getWest()) * t, b.getSouth()],
        [b.getWest() + (b.getEast() - b.getWest()) * t, b.getNorth()],
        [b.getWest(), b.getSouth() + (b.getNorth() - b.getSouth()) * t],
        [b.getEast(), b.getSouth() + (b.getNorth() - b.getSouth()) * t],
      ]) {
        const native = meta.toGeo.inverse([lng, lat]);
        coords.push([
          (native[0] - meta.origin[0]) / (meta.w * meta.scale[0]),
          (meta.origin[1] - native[1]) / (meta.h * meta.scale[1]),
        ]);
      }
    }
    const margin = 0.015,
      x0 = Math.max(0, Math.min(...coords.map((p) => p[0])) - margin),
      y0 = Math.max(0, Math.min(...coords.map((p) => p[1])) - margin),
      x1 = Math.min(1, Math.max(...coords.map((p) => p[0])) + margin),
      y1 = Math.min(1, Math.max(...coords.map((p) => p[1])) + margin);
    return x1 > x0 && y1 > y0
      ? [x0, y0, x1, y1].map((v) => Math.round(v * 1000) / 1000)
      : null;
  }
  function value(v, off, bits, fmt, little) {
    if (fmt === 3)
      return bits === 64
        ? v.getFloat64(off, little)
        : v.getFloat32(off, little);
    if (fmt === 2)
      return bits === 32
        ? v.getInt32(off, little)
        : bits === 16
          ? v.getInt16(off, little)
          : v.getInt8(off);
    return bits === 32
      ? v.getUint32(off, little)
      : bits === 16
        ? v.getUint16(off, little)
        : v.getUint8(off);
  }
  function color(data, c, product, module = "phytobloom") {
    const result = new Uint8ClampedArray((data.length / c) * 4),
      rgb = product.startsWith("RGB");
    let lo = 0,
      hi = 1;
    if (rgb) {
      const v = Array.from(data)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (v.length) {
        lo = v[Math.floor(v.length * 0.02)];
        hi = v[Math.floor(v.length * 0.98)];
      }
    }
    for (let i = 0, j = 0; i < data.length; i += c, j += 4) {
      if (
        !Number.isFinite(data[i]) ||
        (rgb &&
          (!Number.isFinite(data[i + 1]) ||
            !Number.isFinite(data[i + 2]) ||
            (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0)))
      )
        continue;
      if (rgb) {
        for (let b = 0; b < 3; b++)
          result[j + b] =
            255 *
            Math.pow(
              Math.max(
                0,
                Math.min(1, (data[i + b] - lo) / Math.max(hi - lo, 1e-9)),
              ),
              0.8,
            );
      } else {
        const normalized =
          module === "phytobloom" ? (data[i] + 1) / 2 : data[i];
        const t = Math.max(0, Math.min(1, normalized)) * 4,
          n = Math.min(3, Math.floor(t)),
          f = t - n;
        for (let b = 0; b < 3; b++)
          result[j + b] = palette[n][b] * (1 - f) + palette[n + 1][b] * f;
      }
      result[j + 3] = 255;
    }
    return result;
  }
  function warp(meta, crop, sw, sh, rgba) {
    const extent = bounds(meta, crop),
      mw = extent[2] - extent[0],
      mh = extent[3] - extent[1],
      oh = 512,
      ow = Math.max(1, Math.min(1024, Math.round((oh * mw) / mh)));
    const canvas = document.createElement("canvas");
    canvas.width = ow;
    canvas.height = oh;
    const ctx = canvas.getContext("2d"),
      out = ctx.createImageData(ow, oh);
    for (let y = 0; y < oh; y++)
      for (let x = 0; x < ow; x++) {
        const native = meta.toMerc.inverse([
          extent[0] + ((x + 0.5) * mw) / ow,
          extent[3] - ((y + 0.5) * mh) / oh,
        ]);
        const nx =
            ((native[0] - meta.origin[0]) / (meta.w * meta.scale[0]) -
              crop[0]) /
            (crop[2] - crop[0]),
          ny =
            ((meta.origin[1] - native[1]) / (meta.h * meta.scale[1]) -
              crop[1]) /
            (crop[3] - crop[1]);
        if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) continue;
        const src = (Math.floor(ny * sh) * sw + Math.floor(nx * sw)) * 4,
          dst = (y * ow + x) * 4;
        out.data.set(rgba.subarray(src, src + 4), dst);
      }
    ctx.putImageData(out, 0, 0);
    const southWest = proj4("EPSG:3857", "EPSG:4326", [extent[0], extent[1]]),
      northEast = proj4("EPSG:3857", "EPSG:4326", [extent[2], extent[3]]);
    return {
      url: canvas.toDataURL("image/png"),
      bounds: [
        [southWest[1], southWest[0]],
        [northEast[1], northEast[0]],
      ],
      size: [sw, sh],
    };
  }
  async function preview(item, resolution, crop = [0, 0, 1, 1], signal) {
    const meta = await header(item, signal),
      key =
        (item.module || "phytobloom") +
        item.key +
        item.etag +
        resolution +
        crop.join(",");
    if (previews.has(key)) return { ...previews.get(key), cached: true };
    const left = Math.floor(crop[0] * meta.w),
      top = Math.floor(crop[1] * meta.h),
      right = Math.max(left + 1, Math.floor(crop[2] * meta.w)),
      bottom = Math.max(top + 1, Math.floor(crop[3] * meta.h));
    const iw = right - left,
      ih = bottom - top,
      sh = Math.min(resolution, ih),
      sw = Math.min(iw, 1024, Math.max(1, Math.round((sh * iw) / ih))),
      bytesPerPixel = (meta.bits / 8) * meta.c,
      rowBytes = meta.w * bytesPerPixel;
    const data = new Float64Array(sw * sh * meta.c);
    let nodata = Number(meta.fd.GDAL_NODATA);
    if (meta.format === 3 && meta.bits === 32) nodata = Math.fround(nodata);
    let estimate = 0;
    if ((meta.fd.Compression || 1) !== 1 || meta.fd.TileWidth) {
      const tiled = !!meta.fd.TileWidth,
        bw = tiled ? meta.fd.TileWidth : meta.w,
        bh = tiled ? meta.fd.TileLength : meta.fd.RowsPerStrip || meta.h;
      const offsets = tiled ? meta.fd.TileOffsets : meta.fd.StripOffsets,
        counts = tiled ? meta.fd.TileByteCounts : meta.fd.StripByteCounts;
      if ((bw * bh * meta.c * meta.bits) / 8 > 8 * 1048576)
        throw Error("Bloco TIFF grande demais para a prévia econômica.");
      const groups = new Map(),
        across = Math.ceil(meta.w / bw);
      for (let y = 0; y < sh; y++)
        for (let x = 0; x < sw; x++) {
          const sy = top + Math.min(ih - 1, Math.floor(((y + 0.5) * ih) / sh)),
            sx = left + Math.min(iw - 1, Math.floor(((x + 0.5) * iw) / sw));
          const index = Math.floor(sy / bh) * across + Math.floor(sx / bw);
          if (!groups.has(index)) groups.set(index, []);
          groups.get(index).push({
            dest: (y * sw + x) * meta.c,
            source: ((sy % bh) * bw + (sx % bw)) * meta.c,
          });
        }
      estimate = [...groups.keys()].reduce(
        (sum, i) => sum + Number(counts[i]),
        0,
      );
      if (estimate + meta.headerBytes > 16 * 1048576)
        throw Error(
          "Este recorte exigiria mais de 16 MiB. Aproxime o mapa ou escolha um recorte menor.",
        );
      const decoder = await GeoTIFF.getDecoder(meta.fd),
        jobs = [...groups],
        pending = [];
      let cursor = 0;
      async function blockWorker() {
        while (cursor < jobs.length) {
          const [index, points] = jobs[cursor++],
            start = Number(offsets[index]),
            count = Number(counts[index]);
          const encoded = new Uint8Array(count);
          for (let offset = 0; offset < count; offset += 262144) {
            const part = await interval(
              item,
              start + offset,
              start + Math.min(count, offset + 262144) - 1,
              signal,
            );
            encoded.set(new Uint8Array(part), offset);
          }
          const decoded = await decoder.decode(meta.fd, encoded.buffer),
            view = new DataView(decoded);
          for (const point of points)
            for (let band = 0; band < meta.c; band++) {
              let num = value(
                view,
                ((point.source + band) * meta.bits) / 8,
                meta.bits,
                meta.format,
                meta.little,
              );
              if (meta.fd.GDAL_NODATA !== undefined && num === nodata)
                num = NaN;
              data[point.dest + band] = num;
            }
        }
      }
      await Promise.all(Array.from({ length: 6 }, blockWorker));
    } else {
      const rows = [];
      for (let y = 0; y < sh; y++) {
        const sy = top + Math.min(ih - 1, Math.floor(((y + 0.5) * ih) / sh)),
          strip = Math.floor(sy / meta.fd.RowsPerStrip),
          inStrip = sy % meta.fd.RowsPerStrip;
        const start =
            Number(meta.fd.StripOffsets[strip]) +
            inStrip * rowBytes +
            left * bytesPerPixel,
          end = start + iw * bytesPerPixel - 1;
        if (
          end >=
          Number(meta.fd.StripOffsets[strip]) +
            Number(meta.fd.StripByteCounts[strip])
        )
          throw Error("Offsets TIFF inválidos.");
        if (end - start + 1 > 262144)
          throw Error(
            "Faixa larga demais. Aproxime o trecho antes de carregar.",
          );
        rows.push([start, end]);
      }
      estimate = rows.reduce((n, [a, b]) => n + b - a + 1, 0);
      if (estimate > 16 * 1048576)
        throw Error("Prévia excederia 16 MiB. Reduza o detalhe.");

      let next = 0;
      async function worker() {
        while (next < rows.length) {
          const y = next++,
            pair = rows[y];
          const buffer = await interval(item, ...pair, signal),
            v = new DataView(buffer);
          for (let x = 0; x < sw; x++) {
            const sx = Math.min(iw - 1, Math.floor(((x + 0.5) * iw) / sw));
            for (let b = 0; b < meta.c; b++) {
              let num = value(
                v,
                ((sx * meta.c + b) * meta.bits) / 8,
                meta.bits,
                meta.format,
                meta.little,
              );
              if (meta.fd.GDAL_NODATA !== undefined && num === nodata)
                num = NaN;
              data[(y * sw + x) * meta.c + b] = num;
            }
          }
        }
      }
      await Promise.all(Array.from({ length: 8 }, worker));
    }
    const checkSamples = [];
    let finite = 0,
      min = Infinity,
      max = -Infinity;
    for (let i = 0; i < sw * sh; i++) {
      const v = data[i * meta.c];
      if (!Number.isFinite(v)) continue;
      finite++;
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (checkSamples.length < 5)
        checkSamples.push({
          value: v,
          row:
            top +
            Math.min(
              ih - 1,
              Math.floor(((Math.floor(i / sw) + 0.5) * ih) / sh),
            ),
          column:
            left + Math.min(iw - 1, Math.floor((((i % sw) + 0.5) * iw) / sw)),
        });
    }
    const sampleStats = {
      finite,
      total: sw * sh,
      min: finite ? min : null,
      max: finite ? max : null,
      checkSamples,
    };
    const effective = [
        left / meta.w,
        top / meta.h,
        right / meta.w,
        bottom / meta.h,
      ],
      result = {
        ...warp(
          meta,
          effective,
          sw,
          sh,
          color(data, meta.c, item.product, item.module || "phytobloom"),
        ),
        meta,
        sampleStats,
        crop: effective,
        transferred: estimate,
        cached: false,
      };
    previews.set(key, result);
    while (previews.size > 12) previews.delete(previews.keys().next().value);
    return result;
  }
  return { header, preview, cropForBounds, bounds, color };
})();
