"""GET /coach/context: clock, circle, today, levers, flags (docs/contracts.md section 3).

Every number here is copied from A's exports (`web/public/engine/*.json`), from a row C or the
worker stored, or from B's package (stubbed until `social/` lands). The API adds no number of
its own except the caffeine hour, which applies the exported rule verbatim.
"""
import json
import math
import re
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..clock.schema import ClockOut
from ..config import Settings
from ..profile.schema import Profile, me_from
from ..vitals.schema import VitalsOut

DEFAULT_COFFEE_MG = 95  # assumption: one cup; overridable by answers.coffee_mg_per_cup


@lru_cache
def _export(engine_dir: Path, name: str) -> Any:
    p = engine_dir / name
    if not p.exists():
        fallback = Path(__file__).resolve().parents[2] / "fixtures" / f"{name.split('.')[0]}.contract.json"
        p = fallback if fallback.exists() else p
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


_COND = re.compile(r"^\s*(\w+)\s*(<=|>=|==|<|>)\s*([\w.]+)\s*$")


def eval_condition(condition: str, vars: dict[str, Any]) -> bool | None:
    """True/False when every variable is known, None when one is missing or the grammar is not ours."""
    m = _COND.match(condition or "")
    if not m:
        return None
    name, op, rhs = m.groups()
    if name not in vars or vars[name] is None:
        return None
    lhs = vars[name]
    if rhs in ("true", "false"):
        r: Any = rhs == "true"
    else:
        try:
            r = float(rhs)
        except ValueError:
            r = vars.get(rhs)
            if r is None:
                return None
    try:
        return {"<": lhs < r, ">": lhs > r, "<=": lhs <= r, ">=": lhs >= r, "==": lhs == r}[op]
    except TypeError:
        return None


def levers(risk_years: list[dict] | None, vars: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    """(active levers with their exported years, levers whose inputs are still unknown)."""
    active, unknown = [], []
    for row in risk_years or []:
        verdict = eval_condition(row.get("condition", ""), vars)
        item = {k: row.get(k) for k in ("layer", "exposure", "hr", "years", "source", "condition", "label")}
        if verdict is True:
            active.append(item)
        elif verdict is None and _COND.match(row.get("condition", "")):
            unknown.append({"exposure": row["exposure"], "needs": _COND.match(row["condition"]).group(1)})
    return active, unknown


def critical(phenoage: dict | None, clock: ClockOut | None) -> dict:
    """Safety gate 4: any critical-range value suppresses the age number."""
    if not phenoage or not clock or not clock.inputs:
        return {"critical": False, "reasons": []}
    cr = phenoage.get("critical_ranges", {})
    v = clock.inputs
    reasons = []
    g = v.get("glucose")
    if isinstance(g, (int, float)) and "glucose_mgdL" in cr:
        lo, hi = cr["glucose_mgdL"]
        if not lo <= g * 18.016 <= hi:
            reasons.append("glucose")
    w = v.get("wbc")
    if isinstance(w, (int, float)) and "wbc" in cr:
        lo, hi = cr["wbc"]
        if not lo <= w <= hi:
            reasons.append("wbc")
    c = v.get("creatinine")
    ref_high = v.get("creatinine_ref_high") or phenoage.get("creatinine_ref_high_default_umolL")
    if isinstance(c, (int, float)) and ref_high and "creatinine_x_ref_high" in cr and c > cr["creatinine_x_ref_high"] * ref_high:
        reasons.append("creatinine")
    return {"critical": bool(reasons), "reasons": reasons}


def caffeine_plan(caffeine: dict | None, answers: dict) -> dict | None:
    """A's exported rule: last_coffee_h_before_bed = half_life_h * modifier * log2(dose_mg / bedtime_threshold_mg)."""
    if not caffeine:
        return None
    dose = answers.get("coffee_mg_per_cup") or DEFAULT_COFFEE_MG
    modifier = 1.0
    if answers.get("smoker"):
        modifier *= caffeine.get("modifiers", {}).get("smoker", 1.0)
    if answers.get("oral_contraceptive"):
        modifier *= caffeine.get("modifiers", {}).get("oral_contraceptive", 1.0)
    hours = caffeine["half_life_h"] * modifier * math.log2(dose / caffeine["bedtime_threshold_mg"])
    hours = round(max(hours, 0.0), 1)
    bedtime = answers.get("bedtime")
    last_by = None
    if bedtime and re.match(r"^\d{2}:\d{2}$", bedtime):
        hh, mm = map(int, bedtime.split(":"))
        minutes = (hh * 60 + mm - int(round(hours * 60))) % (24 * 60)
        last_by = f"{minutes // 60:02d}:{minutes % 60:02d}"
    return {
        "hours_before_bed": hours,
        "last_coffee_by": last_by,
        "bedtime": bedtime,
        "dose_mg": dose,
        "dose_assumption": None if answers.get("coffee_mg_per_cup") else f"{DEFAULT_COFFEE_MG} mg per cup assumed",
        "half_life_h": caffeine["half_life_h"],
        "threshold_mg": caffeine["bedtime_threshold_mg"],
        "source": caffeine.get("source"),
        "rule": caffeine.get("rule"),
    }


def build_context(
    settings: Settings,
    profile: Profile,
    clocks: dict[str, ClockOut],
    vitals: VitalsOut | None,
    circle: dict | None,
    today: date | None = None,
    history: list | None = None,
) -> dict:
    today = today or datetime.now(timezone.utc).date()
    phenoage = _export(settings.engine_dir, "phenoage.json")
    risk_years = _export(settings.engine_dir, "risk_years.json")
    caffeine = _export(settings.engine_dir, "caffeine.json")
    me = me_from(profile, today, None)
    answers = dict(profile.answers or {})

    crit = critical(phenoage, clocks.get("phenoage"))
    clock_out = {
        name: {
            **c.model_dump(mode="json"),
            "delta_years": round(c.years - c.chronological_age, 1) if c.chronological_age is not None else None,
            "show": not crit["critical"],
        }
        for name, c in clocks.items()
    }
    if phenoage:
        clock_out["labels"] = phenoage.get("labels")

    circle = circle or {"available": False, "todo": "TODO(B): social/ package computeMetrics/lsnsProxy/recurrence"}
    lvars = {**answers, "lsns_proxy": (circle.get("lsns") or {}).get("score"), "vo2max": (clocks.get("fitness").inputs or {}).get("vo2max") if clocks.get("fitness") else None}
    active, unknown = levers(risk_years, lvars)

    flags = {
        "on_glucose_meds": bool(answers.get("on_glucose_meds", False)),
        "critical": crit["critical"],
        "critical_reasons": crit["reasons"],
        "verified": me.verified,
        "over_65": me.over_65,
        "exercise_timing_allowed": not answers.get("on_glucose_meds", False),  # safety gate: medication suppresses timing advice
        "show_age": not crit["critical"],
        "lang": me.lang,
    }
    hist = [h.model_dump(mode="json") for h in (history or [])]
    meals_today = [h for h in hist if h["kind"] == "meal" and str(h["ts"])[:10] == today.isoformat()]
    last_plan = next((h for h in hist if h["kind"] == "plan"), None)
    return {
        "clock": clock_out,
        "circle": circle,
        "today": {
            "vitals": vitals.model_dump(mode="json") if vitals else None,
            "caffeine": caffeine_plan(caffeine, answers),
            "nudge": (circle.get("nudges") or [None])[0] if circle.get("available") else None,
            "meal": ({"carbs_g": (meals_today[0].get("data") or {}).get("carbs_g"), "ts": meals_today[0]["ts"], "note": meals_today[0].get("text")} if meals_today else None),
        },
        "levers": active,
        "levers_unknown": unknown,
        "history": hist,  # newest first: check-ins, plans, nudges, replies, meals, shares
        "last_plan": last_plan,
        "flags": flags,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engine": {"phenoage_version": (phenoage or {}).get("version"), "risk_years_rows": len(risk_years or [])},
    }
