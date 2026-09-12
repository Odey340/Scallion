"""Circle summary stand-in: metrics, LSNS proxy, nudges, heatmap, alerts over synthetic events."""
import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from app.circle.metrics import compute_metrics, heatmap, lsns_proxy, recurrence, summarize
from app.events.schema import Event
from app.routes import events as events_route
from app.routes import persona as persona_route
from scripts.seed_events import synth

NOW = datetime(2026, 9, 12, 20, 0, tzinfo=timezone.utc)
H = lambda s: hashlib.sha256(s.encode()).hexdigest()  # noqa: E731


def ev(contact, days_ago, hours=0, d="in", app="whatsapp"):
    return Event(contact=H(contact), ts=NOW - timedelta(days=days_ago, hours=-hours), app=app, dir=d, len=1)


@pytest.fixture(autouse=True)
def fresh(client):
    events_route.get_store().clear()
    persona_route.get_store().clear()
    yield
    events_route.get_store().clear()
    persona_route.get_store().clear()


def test_two_way_and_close_tie_thresholds():
    evs = []
    for d in (2, 6, 13, 20):  # four exchange days -> close tie
        evs += [ev("a", d, 0, "out"), ev("a", d, 1, "in")]
    evs += [ev("b", 3, 0, "in")]  # one-way only -> not active
    evs += [ev("c", 5, 0, "in"), ev("c", 5 + 8, 0, "out")]  # reply 8 days apart -> not within 7
    m = compute_metrics(evs, NOW, 30)
    assert m["activeTies"] == 1 and m["closeTies"] == 1
    assert m["initiationShare"] == pytest.approx(5 / 7, abs=0.01)  # a: 4 threads I started; b: 1 theirs; c: 1 theirs, 1 mine (8 days apart = 2 threads)
    assert m["replyLatencyH"]["theirs"] == 1.0 and m["silenceDays"] == 2


def test_lsns_buckets_and_risk():
    l = lsns_proxy({"activeTies": 3, "closeTies": 1}, {"help_family": 2, "help_friends": 1})
    assert l["items"] == [3, 3, 1, 1, 2, 1] and l["score"] == 11 and l["atRisk"] is True and l["asked"]
    l2 = lsns_proxy({"activeTies": 9, "closeTies": 5}, {})
    assert l2["items"][:4] == [5, 5, 4, 4] and l2["asked"] is False


def test_recurrence_flags_overdue():
    evs = []
    for d in (60, 53, 46, 39, 32):  # weekly, then silence for 32 days
        evs += [ev("w", d, 0, "out"), ev("w", d, 1, "in")]
    n = recurrence(evs, NOW)
    assert n and n[0]["contact"] == H("w") and n[0]["daysSince"] == 32 and n[0]["medianGapDays"] == 7
    steady = []
    for d in (21, 14, 7, 0):
        steady += [ev("s", d, 0, "out"), ev("s", d, 1, "in")]
    assert recurrence(steady, NOW) == []


def test_heatmap_levels():
    evs = [ev("a", 0), ev("b", 0), ev("c", 0), ev("d", 0), ev("a", 1)]
    hm = heatmap(evs, NOW, weeks=1)
    assert len(hm) == 7 and hm[-1]["people"] == 4 and hm[-1]["level"] == 3 and hm[-2]["level"] == 1 and hm[0]["level"] == 0


def test_summarize_on_synthetic_seed_and_route(client):
    events = synth("test-user", NOW)
    s = summarize(events, {"help_family": 3, "help_friends": 3}, NOW)
    assert s["available"] and s["metrics"]["activeTies"] >= 6 and s["metrics"]["closeTies"] >= 2
    assert any(n["daysSince"] >= 20 for n in s["nudges"])  # the fading contacts
    assert len(s["heatmap"]) == 364 and s["alerts"]
    # through the API: store events, ask for the summary
    r = client.post("/events", json={"events": [e.model_dump(mode="json") for e in events]})
    assert r.status_code == 200 and r.json()["inserted"] == len(events)
    client.put("/me/answers", json={"help_family": 3, "help_friends": 3})
    body = client.get("/circle/summary").json()
    assert body["available"] and body["lsns"]["asked"] and body["metrics"]["window"][1] == datetime.now(timezone.utc).date().isoformat()
    ctx = client.get("/coach/context").json()
    assert ctx["circle"]["available"] and ctx["today"]["nudge"] is not None


def test_no_events_means_unavailable(client):
    assert client.get("/circle/summary").json()["available"] is False
