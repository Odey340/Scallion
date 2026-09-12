"""Coach memory (check-ins), log_meal, share_with_circle (verified gate), /coach/session, context history."""
import hashlib

import pytest

from app.routes import clock as clock_route
from app.routes import memory as memory_route
from app.routes import persona as persona_route
from app.routes import vitals as vitals_route

CONTACT = hashlib.sha256(b"friend").hexdigest()


@pytest.fixture(autouse=True)
def fresh(client):
    for r in (memory_route, persona_route, clock_route, vitals_route):
        r.get_store().clear()
    yield
    for r in (memory_route, persona_route, clock_route, vitals_route):
        r.get_store().clear()


def test_checkin_roundtrip_newest_first(client):
    assert client.post("/coach/checkin", json={"kind": "plan", "text": "dinner walk"}).status_code == 200
    client.post("/coach/checkin", json={"kind": "checkin", "text": "did it", "data": {"walk_done": True}})
    rows = client.get("/coach/checkins").json()
    assert [r["kind"] for r in rows] == ["checkin", "plan"]
    assert rows[0]["data"] == {"walk_done": True} and rows[0]["ts"]
    assert client.get("/coach/checkins", params={"kind": "plan"}).json()[0]["text"] == "dinner walk"
    assert client.post("/coach/checkin", json={"kind": "selfie"}).status_code == 422


def test_log_meal_lands_in_context_today(client):
    r = client.post("/coach/meal", json={"carbs_g": 75, "note": "rice bowl"})
    assert r.status_code == 200 and r.json()["carbs_g"] == 75
    ctx = client.get("/coach/context").json()
    assert ctx["today"]["meal"]["carbs_g"] == 75
    assert ctx["history"][0]["kind"] == "meal"
    assert client.post("/coach/meal", json={"carbs_g": 900}).status_code == 422


def test_share_refuses_unless_verified(client):
    r = client.post("/coach/share", json={"target_contact": CONTACT})
    assert r.status_code == 403 and "not verified" in r.json()["detail"]
    persona_route.get_store().set_verified("00000000-0000-4000-8000-000000000001", None, "inq_t")
    r = client.post("/coach/share", json={"target_contact": CONTACT, "text": "today's plan"})
    assert r.status_code == 200 and r.json()["target_contact"] == CONTACT
    assert client.post("/coach/share", json={"target_contact": "alice@example.com"}).status_code == 422


def test_context_history_and_same_plan_as_yesterday(client):
    client.post("/coach/checkin", json={"kind": "plan", "text": "Same plan as yesterday: dinner walk."})
    client.post("/coach/checkin", json={"kind": "checkin", "text": "Late meeting, no walk."})
    ctx = client.get("/coach/context").json()
    kinds = [h["kind"] for h in ctx["history"]]
    assert kinds[:2] == ["checkin", "plan"]
    assert ctx["last_plan"]["text"].startswith("Same plan")


def test_session_requires_agent_id(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "elevenlabs_agent_id", "")
    assert client.get("/coach/session").status_code == 503
    monkeypatch.setattr(get_settings(), "elevenlabs_agent_id", "agent_test")
    body = client.get("/coach/session").json()  # ELEVENLABS_FAKE=1 in tests: no upstream call
    assert body["agent_id"] == "agent_test" and body["signed_url"] is None
