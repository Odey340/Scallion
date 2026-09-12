"""Minimal circle metrics over hashed contact events (docs/contracts.md section 2 thresholds).

TODO(B): this is Lane D's stand-in built from the contract so the Circle screen has numbers; the
social/ package owns these definitions and replaces this module when it lands. Pure functions
over rows of {contact, ts, app, dir, len}; no content, no handles.

Thresholds (contract): two-way exchange = both directions within 7 days; close tie = 4+ exchange
days in 30; thread gap = 6 h; overdue = daysSince > max(7, median + 2*MAD); distancing =
activeTies down 30%+ or lsns.atRisk.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Iterable

TWO_WAY_DAYS = 7
CLOSE_TIE_EXCHANGE_DAYS = 4
THREAD_GAP_H = 6
OVERDUE_MIN_DAYS = 7
DISTANCING_DROP = 0.30
LSNS_AT_RISK_BELOW = 12


def _utc(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _by_contact(events: Iterable) -> dict[str, list]:
    out: dict[str, list] = defaultdict(list)
    for e in events:
        out[e.contact].append(e)
    for rows in out.values():
        rows.sort(key=lambda e: _utc(e.ts))
    return out


def exchange_days(rows: list, window_start: datetime, window_end: datetime) -> set[date]:
    """Days on which a two-way exchange happened: an in and an out within TWO_WAY_DAYS of each other."""
    ins = [_utc(e.ts) for e in rows if e.dir == "in" and window_start <= _utc(e.ts) <= window_end]
    outs = [_utc(e.ts) for e in rows if e.dir == "out" and window_start <= _utc(e.ts) <= window_end]
    days: set[date] = set()
    for a in ins:
        for b in outs:
            if abs((a - b).total_seconds()) <= TWO_WAY_DAYS * 86400:
                days.add(max(a, b).date())
    return days


def threads(rows: list) -> list[list]:
    """Split one contact's messages into threads at gaps > THREAD_GAP_H."""
    out: list[list] = []
    for e in rows:
        if out and (_utc(e.ts) - _utc(out[-1][-1].ts)) <= timedelta(hours=THREAD_GAP_H):
            out[-1].append(e)
        else:
            out.append([e])
    return out


def reply_latencies(rows: list) -> tuple[list[float], list[float]]:
    """Hours from their message to my next reply (mine) and from mine to theirs (theirs), within a thread."""
    mine, theirs = [], []
    for th in threads(rows):
        for prev, cur in zip(th, th[1:]):
            if prev.dir != cur.dir:
                h = (_utc(cur.ts) - _utc(prev.ts)).total_seconds() / 3600
                (mine if cur.dir == "out" else theirs).append(h)
    return mine, theirs


def compute_metrics(events: list, window_end: datetime, window_days: int = 30) -> dict:
    window_end = _utc(window_end)
    start = window_end - timedelta(days=window_days)
    by = _by_contact(events)
    active, close = 0, 0
    my_starts, all_starts = 0, 0
    lat_mine: list[float] = []
    lat_theirs: list[float] = []
    last_exchange: datetime | None = None
    for contact, rows in by.items():
        days = exchange_days(rows, start, window_end)
        if days:
            active += 1
            last = max(days)
            last_dt = datetime(last.year, last.month, last.day, tzinfo=timezone.utc)
            last_exchange = last_dt if last_exchange is None else max(last_exchange, last_dt)
        if len(days) >= CLOSE_TIE_EXCHANGE_DAYS:
            close += 1
        in_window = [e for e in rows if start <= _utc(e.ts) <= window_end]
        for th in threads(in_window):
            all_starts += 1
            if th[0].dir == "out":
                my_starts += 1
        m, t = reply_latencies(in_window)
        lat_mine += m
        lat_theirs += t
    return {
        "activeTies": active,
        "closeTies": close,
        "initiationShare": round(my_starts / all_starts, 2) if all_starts else 0.0,
        "replyLatencyH": {"mine": round(median(lat_mine), 1) if lat_mine else None, "theirs": round(median(lat_theirs), 1) if lat_theirs else None},
        "churn": 0.0,  # filled by summarize() against the previous window
        "silenceDays": (window_end - last_exchange).days if last_exchange else window_days,
        "window": [start.date().isoformat(), window_end.date().isoformat()],
    }


def _lsns_bucket(n: int) -> int:
    """LSNS-6 answer scale: 0 = none, 1 = one, 2 = two, 3 = three or four, 4 = five to eight, 5 = nine or more."""
    return 0 if n == 0 else 1 if n == 1 else 2 if n == 2 else 3 if n <= 4 else 4 if n <= 8 else 5


def lsns_proxy(metrics: dict, asked: dict) -> dict:
    """4 items from messaging (people heard from monthly x2 network halves, people close enough to talk to x2),
    2 from the user (help_family, help_friends). Score 0-30; at risk below 12 (Lubben)."""
    heard = _lsns_bucket(metrics["activeTies"])
    close = _lsns_bucket(metrics["closeTies"])
    hf = asked.get("help_family")
    hfr = asked.get("help_friends")
    items = [heard, heard, close, close, hf if hf is not None else 0, hfr if hfr is not None else 0]
    score = sum(items)
    return {
        "score": score,
        "atRisk": score < LSNS_AT_RISK_BELOW,
        "items": items,
        "fromMessaging": 4,
        "fromUser": 2,
        "asked": hf is not None and hfr is not None,
        "label": "LSNS-6 proxy, 4 of 6 items from your messaging, 2 from you",
    }


def _mad(xs: list[float]) -> float:
    m = median(xs)
    return median([abs(x - m) for x in xs]) if xs else 0.0


def recurrence(events: list, now: datetime) -> list[dict]:
    """Overdue contacts: days since the last exchange day > max(7, median gap + 2*MAD). Contacts stream."""
    now = _utc(now)
    out = []
    for contact, rows in _by_contact(events).items():
        days = sorted(exchange_days(rows, now - timedelta(days=400), now))
        if len(days) < 3:
            continue
        gaps = [(b - a).days for a, b in zip(days, days[1:]) if (b - a).days > 0]
        if not gaps:
            continue
        med, mad = median(gaps), _mad(gaps)
        threshold = max(OVERDUE_MIN_DAYS, med + 2 * mad)
        since = (now.date() - days[-1]).days
        if since > threshold:
            score = round((since - threshold) / max(threshold, 1), 2)
            out.append({"contact": contact, "kind": "overdue", "medianGapDays": round(med, 1), "daysSince": since, "score": score,
                        "text": f"You usually exchange messages every {round(med)} days; it has been {since}."})
    return sorted(out, key=lambda n: -n["score"])


def heatmap(events: list, now: datetime, weeks: int = 52) -> list[dict]:
    now = _utc(now).date()
    people: dict[date, set] = defaultdict(set)
    for e in events:
        people[_utc(e.ts).date()].add(e.contact)
    out = []
    for i in range(weeks * 7 - 1, -1, -1):
        d = now - timedelta(days=i)
        n = len(people.get(d, ()))
        out.append({"date": d.isoformat(), "people": n, "level": 0 if n == 0 else 1 if n == 1 else 2 if n <= 3 else 3})
    return out


def alerts(prev: dict, curr: dict, lsns: dict) -> list[str]:
    out = []
    if lsns.get("atRisk") or (prev["activeTies"] and curr["activeTies"] < prev["activeTies"] * (1 - DISTANCING_DROP)):
        out.append("distancing")
    elif curr["activeTies"] > 0:
        out.append("active")
    return out


def summarize(events: list, asked: dict, now: datetime, window_days: int = 30, risk_rows: list[dict] | None = None) -> dict:
    now = _utc(now)
    curr = compute_metrics(events, now, window_days)
    prev = compute_metrics(events, now - timedelta(days=window_days), window_days)
    curr["churn"] = round(max(prev["activeTies"] - curr["activeTies"], 0) / prev["activeTies"], 2) if prev["activeTies"] else 0.0
    lsns = lsns_proxy(curr, asked)
    risk = next((r for r in (risk_rows or []) if r.get("exposure") == "social_isolation"), None) if lsns["atRisk"] else None
    return {
        "available": True,
        "metrics": curr,
        "previous": prev,
        "lsns": lsns,
        "nudges": recurrence(events, now)[:5],
        "heatmap": heatmap(events, now),
        "alerts": alerts(prev, curr, lsns),
        "risk": risk,
        "events": len(events),
        "source": "api stand-in over contact_events (TODO(B): social/ package)",
    }
