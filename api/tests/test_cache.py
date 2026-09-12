"""Cached /extract fallback: used when the model fails or when the client prefers it; never otherwise."""
import json

import pytest

from app.extract import cache
from app.extract.schema import ExtractResponse
from app.routes import extract as extract_route
from tests.conftest import FIXTURE_PDF


class Boom:
    def extract(self, data, mime, text):
        raise RuntimeError("model down")


@pytest.fixture
def cached_fixture(tmp_path, monkeypatch, client):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    data = FIXTURE_PDF.read_bytes()
    with FIXTURE_PDF.open("rb") as f:
        live = client.post("/extract", files={"file": ("r.pdf", f, "application/pdf")}).json()
    cache.store(data, ExtractResponse.model_validate(live))
    return data, live


def test_cache_roundtrip(cached_fixture):
    data, live = cached_fixture
    got = cache.cached(data)
    assert got is not None and [a.name for a in got.analytes] == [a["name"] for a in live["analytes"]]
    assert cache.cached(b"%PDF other bytes") is None


def test_fallback_when_model_fails(client, cached_fixture, monkeypatch):
    monkeypatch.setattr(extract_route, "get_extractor", lambda: Boom())
    with FIXTURE_PDF.open("rb") as f:
        r = client.post("/extract", files={"file": ("r.pdf", f, "application/pdf")})
    assert r.status_code == 200
    assert r.headers["x-scallion-cache"] == "hit"
    assert len([a for a in r.json()["analytes"] if not a["name"].startswith("other:")]) == 9


def test_no_cache_means_502_when_model_fails(client, monkeypatch, tmp_path):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(extract_route, "get_extractor", lambda: Boom())
    with FIXTURE_PDF.open("rb") as f:
        assert client.post("/extract", files={"file": ("r.pdf", f, "application/pdf")}).status_code == 502


def test_prefer_header_uses_cache_without_calling_model(client, cached_fixture, monkeypatch):
    monkeypatch.setattr(extract_route, "get_extractor", lambda: Boom())
    with FIXTURE_PDF.open("rb") as f:
        r = client.post("/extract", files={"file": ("r.pdf", f, "application/pdf")}, headers={"X-Scallion-Cache": "prefer"})
    assert r.status_code == 200 and r.headers["x-scallion-cache"] == "hit"


def test_live_path_reports_miss(client, cached_fixture):
    with FIXTURE_PDF.open("rb") as f:
        r = client.post("/extract", files={"file": ("r.pdf", f, "application/pdf")})
    assert r.status_code == 200 and r.headers["x-scallion-cache"] == "miss"
