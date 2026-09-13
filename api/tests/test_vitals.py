"""POST /vitals and GET /vitals/latest against the memory store (no TIGER_DATABASE_URL in tests).
The Tiger path is exercised by tests/test_tiger_integration.py when the URL is set."""
import json

import pytest

from app.config import REPO_DIR
from app.routes import vitals as vitals_routes
from app.routes.vitals import get_store

WORKER_PAYLOAD = REPO_DIR / "presage-worker" / "test" / "fixtures" / "payload.json"

BASE = {"source": "presage", "pulse_bpm": 62, "breathing_bpm": 14, "stress_index": 98, "captured_at": "2026-09-12T14:00:00Z"}


@pytest.fixture(autouse=True)
def fresh_store(client):
    get_store().clear()
    vitals_routes.clear_arms()
    yield
    get_store().clear()
    vitals_routes.clear_arms()


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


# ---- /vitals/arm: the phone's Start asks the laptop worker (--watch) for one capture ----


def test_arm_is_idle_by_default(client):
    body = client.get("/vitals/arm").json()
    assert body == {"armed_at": None, "pending": False, "window_s": vitals_routes.ARM_WINDOW_S, "note": None, "worker_seen_at": None}


def test_arm_then_post_clears_pending(client):
    r = client.post("/vitals/arm")
    assert r.status_code == 200 and r.json()["pending"] is True and r.json()["armed_at"]
    assert client.get("/vitals/arm").json()["pending"] is True
    # a row captured before the arm but received after it still satisfies it: received_at is what counts
    assert client.post("/vitals", json=BASE).status_code == 200
    body = client.get("/vitals/arm").json()
    assert body["pending"] is False and body["armed_at"]  # armed_at is kept so the worker can dedupe


def test_arm_ignores_rows_received_before_it(client):
    client.post("/vitals", json=BASE)
    client.post("/vitals/arm")
    assert client.get("/vitals/arm").json()["pending"] is True


def test_arm_expires_after_window(client, monkeypatch):
    from datetime import datetime, timedelta, timezone

    t0 = datetime(2026, 9, 13, 14, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(vitals_routes, "_now", lambda: t0)
    client.post("/vitals/arm")
    monkeypatch.setattr(vitals_routes, "_now", lambda: t0 + timedelta(seconds=vitals_routes.ARM_WINDOW_S + 1))
    body = client.get("/vitals/arm").json()
    assert body["pending"] is False and body["armed_at"].startswith("2026-09-13T14:00:00")


def test_disarm(client):
    client.post("/vitals/arm")
    r = client.delete("/vitals/arm")
    assert r.status_code == 200 and r.json()["pending"] is False and r.json()["armed_at"] is None
    assert client.get("/vitals/arm").json()["pending"] is False


def test_rearm_moves_armed_at(client, monkeypatch):
    from datetime import datetime, timedelta, timezone

    t0 = datetime(2026, 9, 13, 14, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(vitals_routes, "_now", lambda: t0)
    client.post("/vitals/arm")
    monkeypatch.setattr(vitals_routes, "_now", lambda: t0 + timedelta(seconds=5))
    body = client.post("/vitals/arm").json()
    assert body["armed_at"].startswith("2026-09-13T14:00:05") and body["pending"] is True


def test_worker_note_reaches_the_phone_and_final_ends_the_arm(client):
    client.post("/vitals/arm")
    r = client.patch("/vitals/arm", json={"note": "Face lost; trying once more."})
    assert r.status_code == 200 and r.json()["note"] == "Face lost; trying once more." and r.json()["pending"] is True
    assert client.get("/vitals/arm").json()["note"] == "Face lost; trying once more."
    r = client.patch("/vitals/arm", json={"note": "Webcam busy. Press Start again.", "final": True})
    assert r.json()["armed_at"] is None and r.json()["pending"] is False and r.json()["note"] == "Webcam busy. Press Start again."
    assert r.json()["worker_seen_at"]  # the note came from the worker, so it counts as seen
    # the next Start clears the old reason
    assert client.post("/vitals/arm").json()["note"] is None
    client.patch("/vitals/arm", json={"note": "x"})
    assert client.delete("/vitals/arm").json()["note"] is None


@pytest.mark.parametrize("bad", [{"note": ""}, {"note": "x" * 301}, {}])
def test_note_validation(client, bad):
    assert client.patch("/vitals/arm", json=bad).status_code == 422


def test_worker_polls_stamp_worker_seen_at_but_phone_polls_do_not(client, monkeypatch):
    from datetime import datetime, timedelta, timezone

    t0 = datetime(2026, 9, 13, 14, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(vitals_routes, "_now", lambda: t0)
    # the phone's own status polls never count as a worker
    assert client.get("/vitals/arm").json()["worker_seen_at"] is None
    assert client.post("/vitals/arm").json()["worker_seen_at"] is None
    # the watcher's poll (header) does, and the stamp is visible to the phone on every later read
    r = client.get("/vitals/arm", headers={vitals_routes.WORKER_HEADER: "watch"})
    assert r.json()["worker_seen_at"].startswith("2026-09-13T14:00:00")
    monkeypatch.setattr(vitals_routes, "_now", lambda: t0 + timedelta(seconds=9))
    body = client.get("/vitals/arm").json()
    assert body["worker_seen_at"].startswith("2026-09-13T14:00:00") and body["pending"] is True
    # Cancel keeps the stamp (the worker is still there), a new Start keeps it too
    assert client.delete("/vitals/arm").json()["worker_seen_at"].startswith("2026-09-13T14:00:00")
    assert client.post("/vitals/arm").json()["worker_seen_at"].startswith("2026-09-13T14:00:00")
    # a note from the worker refreshes it
    client.patch("/vitals/arm", json={"note": "Face lost; trying once more."})
    assert client.get("/vitals/arm").json()["worker_seen_at"].startswith("2026-09-13T14:00:09")
