"""Seed 90 days of synthetic hashed contact events for a user (12 contacts, no real people).

    uv run python scripts/seed_events.py --user <uuid> [--print]

Deterministic (seeded RNG). Two close ties, six regular, three fading (stop 3-5 weeks ago), one
one-way. Idempotent thanks to the dedup index; re-running inserts 0.
"""
import hashlib
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings  # noqa: E402
from app.events.schema import Event  # noqa: E402
from app.events.store import build_store  # noqa: E402

PROFILES = [  # (name, app, exchanges per week, fade_days_ago or None, two_way)
    ("close-1", "whatsapp", 5, None, True), ("close-2", "imessage", 4, None, True),
    ("reg-1", "whatsapp", 2, None, True), ("reg-2", "gmail", 1.5, None, True), ("reg-3", "sms", 2, None, True),
    ("reg-4", "whatsapp", 1, None, True), ("reg-5", "gmail", 1, None, True), ("reg-6", "whatsapp", 1.5, None, True),
    ("fade-1", "whatsapp", 3, 24, True), ("fade-2", "imessage", 2, 31, True), ("fade-3", "gmail", 1.5, 38, True),
    ("oneway-newsletter", "gmail", 2, None, False),
]


def synth(user_salt: str, now: datetime, days: int = 90) -> list[Event]:
    rng = random.Random(f"scallion-{user_salt}")
    out: list[Event] = []
    for name, app, per_week, fade, two_way in PROFILES:
        contact = hashlib.sha256(f"{name}|{user_salt}".encode()).hexdigest()
        n = int(per_week * days / 7)
        for _ in range(n):
            d = rng.uniform(0, days)
            if fade is not None and d < fade:
                continue
            t0 = now - timedelta(days=d)
            t0 = t0.replace(hour=rng.choice([9, 12, 13, 18, 19, 20, 21]), minute=rng.randint(0, 59), second=0, microsecond=0)
            first = "out" if rng.random() < 0.55 else "in"
            out.append(Event(contact=contact, ts=t0, app=app, dir=first if two_way else "in", len=rng.choice([0, 1, 1, 2])))
            if two_way and rng.random() < 0.85:
                out.append(Event(contact=contact, ts=t0 + timedelta(minutes=rng.randint(2, 180)), app=app,
                                 dir="in" if first == "out" else "out", len=rng.choice([0, 1, 2, 2])))
    return sorted(out, key=lambda e: e.ts)


def main(argv: list[str]) -> int:
    if "--user" not in argv:
        print("usage: seed_events.py --user <uuid> [--print]")
        return 2
    user = argv[argv.index("--user") + 1]
    events = synth(user, datetime.now(timezone.utc))
    if "--print" in argv:
        for e in events[:5]:
            print(e)
    store = build_store(get_settings())
    n = store.insert(user, events)
    print(f"{len(events)} synthetic events, {n} inserted ({store.name}) for {user}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
