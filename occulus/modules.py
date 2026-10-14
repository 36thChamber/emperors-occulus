"""Additional published raster catalogs; buckets are fixed, never user supplied."""

import re, time, threading

SCENARIO = r"(?:anual_\d{4}_\d{4}|mensal_\d{2}_[a-z]+|futuro_\d{4}_ssp(?:245|585))"
CLASSIC = re.compile(
    r"^predictions/(caraya|guariba|nigritus|aranha)/([A-Za-z_]+)_(nacional_1km|rs_250m|poligono_30m)_("
    + SCENARIO
    + r")_(adequabilidade|incerteza)\.tif$"
)
BATCH = re.compile(
    r"^predicoes_cenarios/([a-z0-9-]+)/([A-Za-z0-9_]+)/("
    + SCENARIO
    + r")/([A-Za-z0-9_]+)_("
    + SCENARIO
    + r")_(adequabilidade(?:_R)?|incerteza|extrapolacao)\.tif$"
)
DAILY = re.compile(
    r"^predictions/daily/(\d{4}-\d{2}-\d{2})/([a-z0-9_]+)/([a-z0-9_]+)_rf_(\d{4}-\d{2}-\d{2})_(mean|sd)\.tif$"
)


def parse(module, key):
    if module == "ste":
        m = CLASSIC.fullmatch(key)
        if m:
            slug, area, region, date, product = m.groups()
            return dict(
                module=module,
                key=key,
                area=area,
                slug=slug,
                region=region,
                date=date,
                product=product,
            )
        m = BATCH.fullmatch(key)
        if m:
            batch, area, date, area2, date2, product = m.groups()
            if area == area2 and date == date2:
                return dict(
                    module=module,
                    key=key,
                    area=area,
                    region="lote:" + batch,
                    date=date,
                    product=product,
                )
    if module == "siapresp":
        m = DAILY.fullmatch(key)
        if m:
            date, area, area2, date2, product = m.groups()
            if area == area2 and date == date2:
                return dict(
                    module=module,
                    key=key,
                    area=area,
                    region="",
                    date=date,
                    product=product,
                )
    return None


class ModuleCatalog:
    def __init__(self, module, s3):
        self.module = module
        self.s3 = s3
        self.items = {}
        self.updated = 0
        self.lock = threading.RLock()
        self.bucket = "ste-siapesq" if module == "ste" else "tifs-siapesq"
        self.prefixes = (
            ["predictions/", "predicoes_cenarios/"]
            if module == "ste"
            else ["predictions/daily/"]
        )

    def list(self, refresh=False):
        with self.lock:
            if not self.updated or refresh and time.time() - self.updated > 60:
                items = {}
                for prefix in self.prefixes:
                    for page in self.s3.get_paginator("list_objects_v2").paginate(
                        Bucket=self.bucket, Prefix=prefix
                    ):
                        for o in page.get("Contents", []):
                            row = parse(self.module, o["Key"])
                            if row:
                                items[o["Key"]] = {
                                    **row,
                                    "bytes": o["Size"],
                                    "etag": o["ETag"],
                                    "published": o["LastModified"].isoformat(),
                                }
                self.items = items
                self.updated = time.time()
            return dict(
                items=list(self.items.values()),
                updated=self.updated,
                bucket=self.bucket,
                module=self.module,
            )
