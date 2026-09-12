"""'Complete your clock': what to order for missing analytes, the re-test date, the fasting action.
Reference data from order_guide.json (labelled, never part of the clock or the coach context)."""
import json
import re
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from .schema import ExtractResponse

GUIDE_PATH = Path(__file__).resolve().parent / "order_guide.json"
_COLLECTED = re.compile(r"(?:collected|collection date|fecha de (?:toma|recolecci[oó]n|extracci[oó]n))\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)


@lru_cache
def guide() -> dict:
    return json.loads(GUIDE_PATH.read_text(encoding="utf-8"))


def collected_date(text: str) -> date | None:
    m = _COLLECTED.search(text or "")
    if not m:
        return None
    raw = m.group(1)
    try:
        if "-" in raw:
            return date.fromisoformat(raw)
        mm, dd, yyyy = raw.split("/")
        return date(int(yyyy), int(mm), int(dd))
    except ValueError:
        return None


def panels_for(missing: list[str]) -> list[dict]:
    """Smallest set of panels covering the missing keys (greedy by coverage)."""
    g = guide()
    todo = set(missing)
    out = []
    while todo:
        best = max(g["panels"].items(), key=lambda kv: len(todo & set(kv[1]["covers"])))
        key, p = best
        hit = todo & set(p["covers"])
        if not hit:
            break
        out.append({"panel": key, "name": p["name"], "covers": sorted(hit), "dtc_usd": p["dtc_usd"], "fasting": p["fasting"]})
        todo -= hit
    return out


def complete_your_clock(resp: ExtractResponse) -> dict:
    g = guide()
    collected = collected_date(resp.text)
    retest = (collected + timedelta(days=g["retest_days"])) if collected else None
    if resp.fasting is False:
        fasting_action = "glucose was not fasting: repeat the CMP after an overnight fast for a clean clock"
    elif resp.fasting is None:
        fasting_action = "fasting status not printed: confirm whether the draw was fasting"
    else:
        fasting_action = None
    derived = [a.name for a in resp.analytes if a.derived]
    return {
        "missing": list(resp.missing),
        "derived": derived,
        "order": panels_for(resp.missing),
        "where": g["where"],
        "collected_date": collected.isoformat() if collected else None,
        "retest_date": retest.isoformat() if retest else None,
        "retest_rule": g["retest_rule"],
        "fasting_action": fasting_action,
        "fasting_hours": g["fasting_hours"],
        "label": "reference prices, not engine output",
    }
