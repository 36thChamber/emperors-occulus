import io, re
from datetime import datetime, timezone
import numpy as np
import pytest
import tifffile
from occulus.core import Catalog, RangeFile, MAX_TRANSFER
from occulus.app import create_app


class FakeS3:
    def __init__(self, data, key="165_2026_10_09_NDCI.tif"):
        self.data = data
        self.key = key
        self.calls = []

    def get_paginator(self, name):
        return self

    def paginate(self, **kw):
        return [
            {
                "Contents": [
                    {
                        "Key": self.key,
                        "Size": len(self.data),
                        "ETag": '"v1"',
                        "LastModified": datetime.now(timezone.utc),
                    }
                ]
            }
        ]

    def get_object(self, **kw):
        assert kw["IfMatch"] == '"v1"'
        a, b = map(int, re.fullmatch(r"bytes=(\d+)-(\d+)", kw["Range"]).groups())
        self.calls.append((a, b))
        data = self.data[a : b + 1]
        return {"Body": io.BytesIO(data), "ContentLength": len(data)}


def fixture(rgb=False):
    a = np.linspace(-1, 1, 160 * 120, dtype="float64").reshape(160, 120)
    if rgb:
        a = np.stack([a, a * 0.5, a * 0.2], axis=2)
    b = io.BytesIO()
    tifffile.imwrite(
        b, a, rowsperstrip=8, photometric="rgb" if rgb else "minisblack", metadata=None
    )
    s = FakeS3(
        b.getvalue(), key="165_2026_10_09_RGB.tif" if rgb else "165_2026_10_09_NDCI.tif"
    )
    c = Catalog(s)
    c.list()
    return c, s, a


def test_sparse_read_and_cache():
    c, s, a = fixture()
    png, m = c.preview(s.key, 96)
    assert png.startswith(b"\x89PNG") and m["previewHeight"] == 96
    assert m["transferred"] < len(s.data) and m["requests"] == len(s.calls)
    n = len(s.calls)
    p, m = c.preview(s.key, 96)
    assert p == png and m["cached"] and m["transferred"] == 0 and len(s.calls) == n


def test_crop_and_rgb():
    c, s, a = fixture(True)
    p, m = c.preview(s.key, 96, (0.25, 0.25, 0.75, 0.75))
    assert m["previewHeight"] == 80 and m["previewWidth"] == 60
    assert m["transferred"] < len(s.data)


def test_actual_sample_values(monkeypatch):
    c, s, a = fixture()
    captured = []
    import occulus.core as core

    original = core.colorize

    def capture(x, p):
        captured.append(x.copy())
        return original(x, p)

    monkeypatch.setattr(core, "colorize", capture)
    c.preview(s.key, 96, (0.25, 0.25, 0.75, 0.75))
    np.testing.assert_allclose(captured[0][:, :, 0], a[40:120, 30:90])


def test_validation_and_no_reads_on_invalid():
    c, s, a = fixture()
    for crop in [(0, 0, 2, 1), (float("nan"), 0, 1, 1), (0, 0, 0, 1)]:
        with pytest.raises(ValueError):
            c.preview(s.key, 96, crop)
    with pytest.raises(ValueError):
        c.preview("../secret", 96)
    assert not s.calls


def test_compression_rejected_without_full_download():
    b = io.BytesIO()
    tifffile.imwrite(b, np.zeros((100, 100)), compression="deflate")
    s = FakeS3(b.getvalue())
    c = Catalog(s)
    c.list()
    with pytest.raises(ValueError, match="formato"):
        c.preview(s.key)


def test_local_api_security():
    c, s, a = fixture()
    app = create_app(c)
    client = app.test_client()
    assert client.get("/api/catalog").status_code == 403
    assert client.get("/", headers={"Host": "malicious.example"}).status_code == 403
    home = client.get("/")
    assert home.headers["Cache-Control"] == "no-store"
    token = re.search('name="occulus-token" content="([^"]+)"', home.text).group(1)
    headers = {"X-Occulus-Token": token}
    assert client.get("/api/catalog", headers=headers).status_code == 200
    r = client.post(
        "/api/preview", headers=headers, json={"key": s.key, "resolution": 96}
    )
    assert r.status_code == 200 and r.json["metadata"]["sampled"]
    assert (
        client.post(
            "/api/preview", headers=headers, json={"key": "not-in-catalog"}
        ).status_code
        == 400
    )


def test_wsl_access_restricts_clients(monkeypatch):
    import occulus.app as module

    monkeypatch.setattr(
        module, "wsl_network", lambda: ("192.168.170.234", "192.168.160.1")
    )
    c, _, _ = fixture()
    client = module.create_app(c).test_client()
    assert (
        client.get(
            "/health",
            base_url="http://192.168.170.234:8765",
            environ_overrides={"REMOTE_ADDR": "192.168.160.1"},
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/health",
            base_url="http://192.168.170.234:8765",
            environ_overrides={"REMOTE_ADDR": "192.168.160.22"},
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/health",
            base_url="http://untrusted.example:8765",
            environ_overrides={"REMOTE_ADDR": "192.168.160.1"},
        ).status_code
        == 403
    )
