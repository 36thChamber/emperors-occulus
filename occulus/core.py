"""Read-only S3 catalog and bounded, sparse GeoTIFF previews. No image files on disk."""

import io, os, re, math, threading, time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import boto3
import numpy as np
import tifffile
from PIL import Image
from botocore.config import Config

PATTERN = re.compile(
    r"^(\d+)_(\d{4})_(\d{2})_(\d{2})_(NDCI|NDVI2?|RGB(?:_MASK)?)\.tif$"
)
MAX_TRANSFER = 16 * 1024 * 1024


class RangeFile(io.RawIOBase):
    """Seekable TIFF header reader with a hard metadata transfer bound."""

    def __init__(self, s3, bucket, key, size, etag):
        self.s3, self.bucket, self.key, self.size, self.etag = (
            s3,
            bucket,
            key,
            size,
            etag,
        )
        self.pos = self.transferred = self.requests = 0
        self.blocks = {}
        self.name = key

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = (
            offset
            if whence == 0
            else self.pos + offset
            if whence == 1
            else self.size + offset
        )
        if self.pos < 0:
            raise ValueError("Posição inválida")
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n > 2 * 1024 * 1024:
            raise ValueError("Cabeçalho TIFF excede o limite seguro de leitura.")
        end = min(self.size, self.pos + n)
        pieces = []
        while self.pos < end:
            start = self.pos // 65536 * 65536
            if start not in self.blocks:
                if self.transferred + min(65536, self.size - start) > 2 * 1024 * 1024:
                    raise ValueError("Metadados excedem 2 MiB. Use um TIFF otimizado.")
                data = fetch_range(
                    self.s3,
                    self.bucket,
                    self.key,
                    start,
                    min(start + 65535, self.size - 1),
                    self.etag,
                )
                self.blocks[start] = data
                self.transferred += len(data)
                self.requests += 1
            block = self.blocks[start]
            stop = min(end, start + len(block))
            if stop <= self.pos:
                raise ValueError("TIFF truncado")
            pieces.append(block[self.pos - start : stop - start])
            self.pos = stop
        return b"".join(pieces)


def fetch_range(s3, bucket, key, start, end, etag):
    r = s3.get_object(
        Bucket=bucket, Key=key, Range=f"bytes={start}-{end}", IfMatch=etag
    )
    try:
        if r.get("ContentLength") != end - start + 1:
            raise ValueError("Resposta de intervalo inesperada")
        b = r["Body"].read()
    finally:
        r["Body"].close()
    if len(b) != end - start + 1:
        raise ValueError("Leitura incompleta")
    return b


def colorize(a, product):
    if product.startswith("RGB"):
        valid = np.isfinite(a).all(axis=2) & (a != 0).any(axis=2)
        # Stretch is display-only and calculated from this preview, not scientific statistics.
        values = a[valid]
        lo, hi = np.percentile(values, [2, 98]) if values.size else (0, 1)
        rgb = np.clip((np.nan_to_num(a) - lo) / max(float(hi - lo), 1e-9), 0, 1) ** 0.8
    else:
        v = a[:, :, 0]
        valid = np.isfinite(v)
        stops = (
            np.array(
                [
                    [32, 75, 135],
                    [48, 153, 179],
                    [225, 235, 188],
                    [246, 187, 79],
                    [207, 71, 57],
                ]
            )
            / 255
        )
        t = np.clip((np.nan_to_num(v) + 1) / 2, 0, 1) * 4
        low = np.minimum(t.astype(int), 3)
        f = (t - low)[..., None]
        rgb = stops[low] * (1 - f) + stops[low + 1] * f
    rgba = np.dstack(((rgb * 255).astype("uint8"), valid.astype("uint8") * 255))
    out = io.BytesIO()
    Image.fromarray(rgba).save(out, format="PNG")
    return out.getvalue(), round(float(valid.mean()) * 100, 1)


class Catalog:
    def __init__(self, s3=None):
        self.s3 = s3 or boto3.client(
            "s3",
            region_name=os.getenv("AWS_REGION", "sa-east-1"),
            config=Config(
                max_pool_connections=12,
                retries={"max_attempts": 3},
                connect_timeout=8,
                read_timeout=30,
            ),
        )
        self.bucket = os.getenv("OCCULUS_BUCKET", "copel-siapesq")
        self.items = {}
        self.updated = 0
        self.lock = threading.RLock()
        self.cache = OrderedDict()
        self.work = threading.Lock()

    def list(self, refresh=False):
        with self.lock:
            if not self.updated or (refresh and time.time() - self.updated > 60):
                found = {}
                for page in self.s3.get_paginator("list_objects_v2").paginate(
                    Bucket=self.bucket
                ):
                    for o in page.get("Contents", []):
                        m = PATTERN.fullmatch(o["Key"])
                        if not m:
                            continue
                        area, y, mo, d, product = m.groups()
                        try:
                            day = date(int(y), int(mo), int(d)).isoformat()
                        except ValueError:
                            continue
                        found[o["Key"]] = {
                            "key": o["Key"],
                            "area": area,
                            "date": day,
                            "product": product,
                            "bytes": o["Size"],
                            "etag": o["ETag"],
                            "published": o["LastModified"].isoformat(),
                        }
                self.items = found
                self.updated = time.time()
                self.cache.clear()
            return {
                "items": list(self.items.values()),
                "updated": self.updated,
                "bucket": self.bucket,
            }

    def preview(self, key, resolution=128, crop=(0, 0, 1, 1)):
        if resolution not in (96, 128, 256):
            raise ValueError("Resolução inválida")
        if len(crop) != 4 or not all(math.isfinite(v) for v in crop):
            raise ValueError("Recorte inválido")
        x0, y0, x1, y1 = crop
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise ValueError("Recorte fora da imagem")
        with self.lock:
            item = self.items.get(key)
        if not item:
            raise ValueError("Arquivo não encontrado no catálogo. Atualize a lista.")
        ck = (key, item["etag"], resolution, crop)
        with self.work:
            if ck in self.cache:
                value = self.cache.pop(ck)
                self.cache[ck] = value
                return value[0], dict(value[1], cached=True, transferred=0, requests=0)
            value = self._read(item, resolution, crop)
            self.cache[ck] = value
            while len(self.cache) > 24:
                self.cache.popitem(last=False)
            return value

    def _read(self, item, resolution, crop):
        key = item["key"]
        f = RangeFile(self.s3, self.bucket, key, item["bytes"], item["etag"])
        with tifffile.TiffFile(f) as tif:
            p = tif.pages[0]
            if p.is_tiled or int(p.compression) != 1 or int(p.predictor) != 1:
                raise ValueError(
                    "Este TIFF usa um formato ainda não suportado pelo leitor econômico. Nenhum download integral foi feito."
                )
            if int(p.planarconfig) != 1 or p.samplesperpixel not in (1, 3):
                raise ValueError("Organização de bandas não suportada.")
            w, h, c = p.imagewidth, p.imagelength, p.samplesperpixel
            dtype = np.dtype(p.dtype).newbyteorder(tif.byteorder)
            offsets = tuple(p.dataoffsets)
            counts = tuple(p.databytecounts)
            rows = int(p.rowsperstrip)
            tags = {
                name: p.tags[name].value
                for name in [
                    "ModelPixelScaleTag",
                    "ModelTiepointTag",
                    "GeoKeyDirectoryTag",
                    "GDAL_NODATA",
                ]
                if name in p.tags
            }
        left, top = int(crop[0] * w), int(crop[1] * h)
        right, bottom = max(left + 1, int(crop[2] * w)), max(top + 1, int(crop[3] * h))
        sw, sh = right - left, bottom - top
        oh = min(sh, resolution)
        ow = min(sw, max(1, round(oh * sw / sh)), 1024)
        ys = top + np.minimum(((np.arange(oh) + 0.5) * sh / oh).astype(int), sh - 1)
        xs = np.minimum(((np.arange(ow) + 0.5) * sw / ow).astype(int), sw - 1)
        ranges = []
        rowbytes = w * c * dtype.itemsize
        for y in ys:
            idx = int(y) // rows
            within = int(y) % rows
            start = offsets[idx] + within * rowbytes + left * c * dtype.itemsize
            end = start + sw * c * dtype.itemsize - 1
            if end >= offsets[idx] + counts[idx] or end >= item["bytes"]:
                raise ValueError("TIFF com offsets inválidos")
            ranges.append((start, end))

        def cached_bytes(pair):
            start, end = pair
            blockstart = start // 65536 * 65536
            block = f.blocks.get(blockstart)
            if block is not None and end < blockstart + len(block):
                return block[start - blockstart : end - blockstart + 1]
            return None

        remote_ranges = [pair for pair in ranges if cached_bytes(pair) is None]
        estimate = sum(b - a + 1 for a, b in remote_ranges) + f.transferred
        if estimate > MAX_TRANSFER:
            raise ValueError(
                "Esta prévia ultrapassaria 16 MiB. Escolha qualidade econômica ou aproxime o recorte."
            )

        def row(pair):
            data = cached_bytes(pair)
            if data is None:
                data = fetch_range(self.s3, self.bucket, key, *pair, item["etag"])
            return np.frombuffer(data, dtype=dtype).reshape(sw, c)[xs]

        with ThreadPoolExecutor(max_workers=8) as pool:
            a = np.stack(list(pool.map(row, ranges))).astype(float)
        if "GDAL_NODATA" in tags:
            try:
                a[a == float(tags["GDAL_NODATA"])] = np.nan
            except ValueError:
                pass
        png, valid = colorize(a, item["product"])
        meta = {
            "transferred": estimate,
            "requests": len(remote_ranges) + f.requests,
            "cached": False,
            "originalBytes": item["bytes"],
            "width": w,
            "height": h,
            "previewWidth": ow,
            "previewHeight": oh,
            "validSamplePercent": valid,
            "crop": crop,
            "product": item["product"],
            "key": key,
            "sampled": True,
        }
        # Native bounds and EPSG for orientation, without requesting a basemap.
        if "ModelPixelScaleTag" in tags and "ModelTiepointTag" in tags:
            sx, sy, *_ = tags["ModelPixelScaleTag"]
            i, j, _, tx, ty, _ = tags["ModelTiepointTag"]
            west = tx - i * sx
            north = ty + j * sy
            meta["nativeBounds"] = [west, north - h * sy, west + w * sx, north]
        if "GeoKeyDirectoryTag" in tags:
            g = tags["GeoKeyDirectoryTag"]
            for k in range(4, len(g), 4):
                if g[k] in (2048, 3072) and g[k + 1] == 0 and g[k + 3] != 32767:
                    meta["epsg"] = g[k + 3]
        return png, meta
