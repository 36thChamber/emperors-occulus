"""Allowlisted experimental copies, separated from official raster paths."""
import json
import time
from .modules import parse

PREFIX = "auspex/cog-avaliacao/2026-10-20/"
BUCKET = "ste-siapesq"


class CogEvaluation:
    def __init__(self, s3):
        self.s3 = s3
        self.updated = 0
        self.files = {}

    def index(self):
        if not self.updated or time.time() - self.updated > 600:
            manifest = json.loads(self.s3.get_object(Bucket=BUCKET, Key=PREFIX + "pilot-manifest.json")["Body"].read())
            if manifest.get("status") != "validated" or manifest.get("errors"):
                raise ValueError("Avaliação COG ainda não validada.")
            files = {}
            for row in manifest.get("files", []):
                source = row.get("source_key", "")
                if (row.get("module") == "ste" and row.get("bucket") == BUCKET
                    and row.get("source_bucket") == BUCKET and parse("ste", source)
                    and row.get("key") == PREFIX + "ste/" + source
                    and all(row.get(x) for x in ["cog_valid", "pixels_bitwise_equal", "masks_equal", "range_read_verified"])):
                    files[source] = row
            self.files, self.updated = files, time.time()
        return self.files

    def catalog(self, original):
        index = self.index()
        return {**original, "dataset": "cog", "experimental": True, "items": [
            {**item, "dataset": "cog", "bytes": index[item["key"]]["bytes"], "etag": index[item["key"]]["etag"]}
            for item in original["items"] if item["key"] in index and index[item["key"]]["source_etag"] == item["etag"]
        ]}
