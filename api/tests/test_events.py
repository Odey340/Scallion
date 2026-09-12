"""POST /events, DELETE /events, DELETE /events/{contact} on the memory store."""
import hashlib

import pytest

from app.routes.events import get_store

H = [hashlib.sha256(f"contact{i}".encode()).hexdigest() for i in range(3)]


def ev(i, hour, d="in"):
    return {"contact": H[i], "ts": f"2026-09-{10 + i:02d}T{hour:02d}:00:00Z", "app": "gmail", "dir": d, "len": 1}


BATCH = [ev(0, 9), ev(0, 10, "out"), ev(1, 9), ev(2, 12)]


@pytest.fixture(autouse=True)
def fresh(client):
    get_store().clear()
    yield
    get_store().clear()


def test_insert_then_resend_is_idempotent(client):
    r = client.post("/events", json={"events": BATCH})
    assert r.status_code == 200
    assert r.json() == {"inserted": 4, "received": 4, "duplicates": 0}
    r = client.post("/events", json={"events": BATCH + [ev(2, 13)]})
    assert r.json() == {"inserted": 1, "received": 5, "duplicates": 4}
    assert get_store().count("00000000-0000-4000-8000-000000000001") == 5


def test_forget_one_contact_then_all(client):
    client.post("/events", json={"events": BATCH})
    assert client.delete(f"/events/{H[0]}").json() == {"deleted": 2}
    assert client.delete("/events").json() == {"deleted": 2}
    assert client.delete("/events").json() == {"deleted": 0}


@pytest.mark.parametrize(
    "bad",
    [
        {"contact": "alice@example.com"},  # a handle, not a hash: privacy by construction
        {"contact": "A" * 64},
        {"app": "signal"},
        {"dir": "both"},
        {"len": 4},
        {"ts": "yesterday"},
    ],
)
def test_validation(client, bad):
    r = client.post("/events", json={"events": [{**ev(0, 9), **bad}]})
    assert r.status_code == 422, bad


def test_empty_batch_is_fine(client):
    assert client.post("/events", json={"events": []}).json()["inserted"] == 0


def test_contact_path_must_be_a_hash(client):
    assert client.delete("/events/alice@example.com").status_code == 422
