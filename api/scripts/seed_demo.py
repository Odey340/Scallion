"""Seed two prior check-ins (and a logged meal) for the demo user so the coach can answer
"same plan as yesterday?" on stage.

    uv run python scripts/seed_demo.py --user <uuid>      # needs TIGER_DATABASE_URL in ../.env

Idempotent: skips when the user already has a 'plan' row from the seed.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.checkins.schema import CheckinIn  # noqa: E402
from app.checkins.store import build_store  # noqa: E402
from app.config import get_settings  # noqa: E402

SEED = [
    (2, "plan", "Walk ten minutes after dinner; last coffee before four.", {"seed": True, "walk": True}),
    (2, "checkin", "Did the walk. Felt fine. Skipped dessert.", {"seed": True, "walk_done": True}),
    (1, "plan", "Same plan as yesterday: dinner walk, coffee cut-off.", {"seed": True, "walk": True}),
    (1, "checkin", "Late meeting, no walk. Coffee at three.", {"seed": True, "walk_done": False}),
    (1, "meal", "Rice bowl", {"seed": True, "carbs_g": 75}),
]


def main(argv: list[str]) -> int:
    if "--user" not in argv:
        print("usage: seed_demo.py --user <uuid>")
        return 2
    user = argv[argv.index("--user") + 1]
    store = build_store(get_settings())
    if any((r.data or {}).get("seed") for r in store.recent(user, 20, "plan")):
        print("already seeded for", user)
        return 0
    now = datetime.now(timezone.utc).replace(hour=20, minute=30, second=0, microsecond=0)
    for days_ago, kind, text, data in SEED:
        ts = now - timedelta(days=days_ago) + (timedelta(hours=1) if kind != "plan" else timedelta())
        row = store.insert(user, CheckinIn(kind=kind, text=text, data=data), ts=ts)
        print(f"  {row.ts:%Y-%m-%d %H:%M} {kind:8s} {text}")
    print("seeded", len(SEED), "rows for", user, "into", store.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
