"""Backboard mirror wiring with a fake client: check-ins are remembered, recall searches, no key = table only."""
import pytest

from app.checkins.backboard import NoMemory, build_memory
from app.config import Settings
from app.routes import memory as memory_route
from app.routes import persona as persona_route


class FakeMemory:
    name = "backboard"

    def __init__(self):
        self.remembered = []

    def remember(self, user_id, text, metadata=None):
        self.remembered.append((user_id, text, metadata))

    def recall(self, user_id, query, limit=5):
        return [{"content": t, "score": 0.9, "created_at": None} for _, t, _ in self.remembered if query.split()[0].lower() in t.lower()][:limit]


@pytest.fixture(autouse=True)
def fresh(client, monkeypatch):
    memory_route.get_store().clear()
    persona_route.get_store().clear()
    fake = FakeMemory()
    monkeypatch.setattr(memory_route, "get_memory", lambda: fake)
    yield fake
    memory_route.get_store().clear()


def test_no_key_means_table_only():
    class Ids:
        def get(self, u): return None
        def set(self, u, a): pass
    assert isinstance(build_memory(Settings(backboard_api_key=""), Ids()), NoMemory)


def test_checkins_are_mirrored_and_recalled(client, fresh):
    client.post("/coach/checkin", json={"kind": "plan", "text": "Walk after dinner, coffee before four."})
    client.post("/coach/meal", json={"carbs_g": 60, "note": "tacos"})
    assert [t for _, t, _ in fresh.remembered][0].startswith("plan: Walk after dinner")
    assert any("meal" in t and "60" in t for _, t, _ in fresh.remembered)
    r = client.get("/coach/recall", params={"q": "walk plan"})
    assert r.status_code == 200
    body = r.json()
    assert body["memory"] == "backboard" and body["hits"][0]["content"].startswith("plan: Walk")


def test_health_reports_memory_backend(client):
    assert client.get("/health").json()["memory"] in ("backboard", "table")
