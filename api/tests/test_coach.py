"""GET /coach/context, levers from risk_years.json, safety flags, POST /coach/validate, POST /clock."""
import json

import pytest

from app.coach.context import caffeine_plan, eval_condition, levers
from app.coach.validator import validate_narration
from app.config import API_DIR
from app.routes import clock as clock_route
from app.routes import persona as persona_route
from app.routes import vitals as vitals_route


@pytest.fixture(autouse=True)
def fresh(client):
    for r in (clock_route, persona_route, vitals_route):
        r.get_store().clear()
    yield
    for r in (clock_route, persona_route, vitals_route):
        r.get_store().clear()


PHENO = {"clock": "phenoage", "years": 41.3, "chronological_age": 34, "band": 2.4, "engine_version": "1",
         "inputs": {"albumin": 44, "creatinine": 80, "glucose": 5.4, "crp": 0.08, "lymph_pct": 30, "mcv": 90, "rdw": 13.1, "alp": 70, "wbc": 6.2}}


def test_eval_condition_grammar():
    assert eval_condition("sleep_h < 6", {"sleep_h": 5}) is True
    assert eval_condition("sleep_h < 6", {"sleep_h": 7}) is False
    assert eval_condition("sleep_h < 6", {}) is None
    assert eval_condition("smoker == true", {"smoker": True}) is True
    assert eval_condition("lsns_proxy < 12", {"lsns_proxy": None}) is None
    assert eval_condition("per 3.5 mL/kg/min of VO2max", {}) is None


def test_levers_from_real_export():
    from app.coach.context import _export
    from app.config import get_settings

    rows = _export(get_settings().engine_dir, "risk_years.json")
    active, unknown = levers(rows, {"sleep_h": 5, "smoker": False, "lonely": False, "lives_alone": True})
    names = {l["exposure"] for l in active}
    assert names == {"short_sleep", "living_alone"}
    assert all(l["years"] and l["source"] and "population estimate" in l["label"] for l in active)
    assert {u["needs"] for u in unknown} == {"lsns_proxy", "vo2max"}


def test_caffeine_rule_matches_export():
    caf = {"half_life_h": 5, "modifiers": {"smoker": 0.5}, "bedtime_threshold_mg": 50, "source": "x", "rule": "r"}
    p = caffeine_plan(caf, {"bedtime": "23:00"})
    assert p["hours_before_bed"] == pytest.approx(5 * 0.926, abs=0.05)  # log2(95/50)
    assert p["last_coffee_by"] == "18:24"  # 4.6 h before 23:00
    assert p["dose_assumption"]
    p2 = caffeine_plan(caf, {"bedtime": "23:00", "smoker": True, "coffee_mg_per_cup": 200})
    assert p2["hours_before_bed"] == pytest.approx(5 * 0.5 * 2, abs=0.05) and p2["dose_assumption"] is None


def test_context_empty_user(client):
    ctx = client.get("/coach/context").json()
    assert ctx["clock"] == {} or set(ctx["clock"]) <= {"labels"}
    assert ctx["circle"]["available"] is False
    assert ctx["today"]["vitals"] is None and ctx["today"]["caffeine"]["last_coffee_by"] is None
    assert ctx["levers"] == []
    assert ctx["flags"]["critical"] is False and ctx["flags"]["show_age"] is True and ctx["flags"]["exercise_timing_allowed"] is True


def test_context_assembles_clock_vitals_answers(client):
    assert client.post("/clock", json=PHENO).status_code == 200
    client.post("/vitals", json={"pulse_bpm": 68.5, "captured_at": "2026-09-12T16:35:49Z"})
    client.put("/me/answers", json={"sleep_h": 5.5, "smoker": True, "on_glucose_meds": True, "bedtime": "22:30"})
    ctx = client.get("/coach/context").json()
    assert ctx["clock"]["phenoage"]["years"] == 41.3 and ctx["clock"]["phenoage"]["show"] is True
    assert ctx["today"]["vitals"]["pulse_bpm"] == 68.5
    assert ctx["today"]["caffeine"]["last_coffee_by"] is not None
    assert {l["exposure"] for l in ctx["levers"]} == {"short_sleep", "smoking"}
    assert ctx["flags"]["on_glucose_meds"] is True and ctx["flags"]["exercise_timing_allowed"] is False
    assert client.get("/clock/latest").json()["phenoage"]["band"] == 2.4


def test_critical_value_suppresses_age(client):
    bad = {**PHENO, "inputs": {**PHENO["inputs"], "glucose": 15.0}}  # 270 mg/dL > 250
    client.post("/clock", json=bad)
    ctx = client.get("/coach/context").json()
    assert ctx["flags"]["critical"] is True and ctx["flags"]["critical_reasons"] == ["glucose"]
    assert ctx["clock"]["phenoage"]["show"] is False and ctx["flags"]["show_age"] is False


def test_validator_only_allows_context_numbers(client):
    client.post("/clock", json=PHENO)
    ok = client.post("/coach/validate", json={"text": "Your biological age is about 41 years, 7 years above 34. RDW is 13.1."}).json()
    assert ok["ok"] is True, ok
    bad = client.post("/coach/validate", json={"text": "You could gain 12 years by sleeping more."}).json()
    assert bad["ok"] is False and bad["unknown_numbers"] == ["12"]


def test_validator_unit():
    ctx = {"a": 2.94, "b": "8 of 9 markers", "c": [1.29]}
    assert validate_narration("2.9 years, 8 of 9, HR 1.29", ctx)["ok"]
    assert validate_narration("3 years", ctx)["ok"]  # 2.94 rounds to 3
    assert not validate_narration("4 years", ctx)["ok"]
    assert validate_narration("no numbers here", {})["ok"]


def test_coach_tools_json_shape():
    tools = json.loads((API_DIR / "coach_tools.json").read_text(encoding="utf-8"))
    names = [t["name"] for t in tools["tools"]]
    assert names == ["get_clock", "get_circle", "explain_analyte", "get_today_plan", "log_meal", "share_with_circle"]
    assert "estimate, not a diagnosis" in tools["system_prompt"]
    assert "never 'life lost'" in tools["system_prompt"]


def test_answers_validation_and_merge(client):
    assert client.put("/me/answers", json={"sleep_h": 30}).status_code == 422
    assert client.put("/me/answers", json={"help_family": 6}).status_code == 422
    client.put("/me/answers", json={"sleep_h": 7, "help_family": 3})
    client.put("/me/answers", json={"help_friends": 2})
    assert client.get("/me").json()["answers"] == {"sleep_h": 7, "help_family": 3, "help_friends": 2}
