"""POST /vitals and GET /vitals/latest against the memory store (no TIGER_DATABASE_URL in tests).
The Tiger path is exercised by tests/test_tiger_integration.py when the URL is set."""
import json

import pytest

from app.config import REPO_DIR
from app.routes.vitals import get_store

WORKER_PAYLOAD = REPO_DIR / "presage-worker" / "test" / "fixtures" / "payload.json"

BASE = {"source": "presage", "pulse_bpm": 62, "breathing_bpm": 14, "stress_index": 98, "captured_at": "2026-09-12T14:00:00Z"}


@pytest.fixture(autouse=True)
def fresh_store(client):
    get_store().clear()
    yield
    get_store().clear()


def test_latest_is_404_when_empty(client):
    r = client.get("/vitals/latest")
    assert r.status_code == 404
    assert r.json()["detail"] == "no vitals yet"


def test_post_then_latest_roundtrip(client):
    r = client.post("/vitals", json=BASE)
    assert r.status_code == 200 and r.json() == {"ok": True}
    r = client.get("/vitals/latest")
    assert r.status_code == 200
    body = r.json()
    assert body["pulse_bpm"] == 62 and body["breathing_bpm"] == 14 and body["stress_index"] == 98
    assert body["captured_at"].startswith("2026-09-12T14:00:00")
    assert body["received_at"]
    assert body["hrv_rmssd_ms"] is None  # optional extras default to null


def test_latest_is_by_captured_at_not_insert_order(client):
    client.post("/vitals", json={**BASE, "pulse_bpm": 70, "captured_at": "2026-09-12T15:00:00Z"})
    client.post("/vitals", json={**BASE, "pulse_bpm": 60, "captured_at": "2026-09-12T13:00:00Z"})
    assert client.get("/vitals/latest").json()["pulse_bpm"] == 70


@pytest.mark.parametrize("bad", [{"pulse_bpm": 0}, {"pulse_bpm": 300}, {"breathing_bpm": 90}, {"source": "watch"}, {"confidence": 1.5}])
def test_validation(client, bad):
    assert client.post("/vitals", json={**BASE, **bad}).status_code == 422


def test_missing_captured_at_is_422(client):
    body = {k: v for k, v in BASE.items() if k != "captured_at"}
    assert client.post("/vitals", json=body).status_code == 422


def test_worker_fixture_payload_is_accepted_verbatim(client):
    """The presage-worker's reference payload (its own unit test pins it) must post as-is."""
    payload = json.loads(WORKER_PAYLOAD.read_text(encoding="utf-8"))
    assert client.post("/vitals", json=payload).status_code == 200, payload
    latest = client.get("/vitals/latest").json()
    for k, v in payload.items():
        if k != "captured_at":
            assert latest[k] == v, k


def test_health_reports_memory_db(client):
    assert client.get("/health").json()["db"] == "memory"
