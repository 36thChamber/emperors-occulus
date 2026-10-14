from occulus.modules import parse, ModuleCatalog
from datetime import datetime, timezone


def test_source_paths_and_compatibility():
    key = (
        "predictions/aranha/Primatas_grupo_poligono_30m_mensal_01_janeiro_incerteza.tif"
    )
    assert parse("ste", key)["area"] == "Primatas_grupo"
    assert parse("ste", key.replace("/aranha/", "/primatas_grupo/")) is None
    assert parse("ste", "migration-backups/" + key) is None
    d = "predictions/daily/2026-10-12/camarao/camarao_rf_2026-10-12_sd.tif"
    assert parse("siapresp", d)["date"] == "2026-10-12"
    assert parse("siapresp", d.replace("/camarao_rf", "/other_rf")) is None


def test_catalog_filters_outputs_and_records_source_bucket():
    class S3:
        def get_paginator(self, name):
            return self

        def paginate(self, **kwargs):
            assert kwargs["Bucket"] == "tifs-siapesq"
            assert kwargs["Prefix"] == "predictions/daily/"
            return [
                {
                    "Contents": [
                        {
                            "Key": k,
                            "Size": 10,
                            "ETag": "v",
                            "LastModified": datetime.now(timezone.utc),
                        }
                        for k in [
                            "predictions/daily/2026-10-12/camarao/camarao_rf_2026-10-12_mean.tif",
                            "predictors/daily/2026-10-12/CHL.nc",
                            "predictions/daily/2026-10-12/run_summary.csv",
                        ]
                    ]
                }
            ]

    c = ModuleCatalog("siapresp", S3())
    result = c.list()
    assert len(result["items"]) == 1 and result["bucket"] == "tifs-siapesq"
