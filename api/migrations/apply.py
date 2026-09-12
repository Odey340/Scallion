"""Apply api/migrations/NNNN_*.sql to Tiger Data (TimescaleDB), in order, once each.

    uv run python migrations/apply.py          # apply pending migrations
    uv run python migrations/apply.py --show   # then list tables, hypertables, continuous aggregates
    uv run python migrations/apply.py --dry-run

Reads TIGER_DATABASE_URL from the environment or the repo-root .env (via app.config.Settings).
Runs in autocommit because continuous aggregates cannot be created inside a transaction.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # so `app` imports when run as a script

from app.config import get_settings  # noqa: E402

MIGRATIONS_DIR = Path(__file__).resolve().parent


def migration_files() -> list[Path]:
    files = sorted(p for p in MIGRATIONS_DIR.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    numbers = [int(p.name[:4]) for p in files]
    if numbers != list(range(1, len(files) + 1)):
        raise SystemExit(f"migrations must be numbered 0001.. without gaps, got {numbers}")
    return files


def apply(url: str, dry_run: bool = False) -> list[str]:
    import psycopg

    applied: list[str] = []
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(
            "create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null)"
        )
        done = {r[0] for r in conn.execute("select filename from schema_migrations")}
        for path in migration_files():
            if path.name in done:
                print(f"  skip  {path.name}")
                continue
            print(f"  apply {path.name}")
            if dry_run:
                continue
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute(
                "insert into schema_migrations (filename, applied_at) values (%s, %s)",
                (path.name, datetime.now(timezone.utc)),
            )
            applied.append(path.name)
    return applied


def show(url: str) -> None:
    import psycopg

    with psycopg.connect(url, autocommit=True) as conn:
        print("\ntables:")
        for (name,) in conn.execute(
            "select table_name from information_schema.tables where table_schema = 'public' order by 1"
        ):
            print(f"  {name}")
        print("hypertables:")
        for name, dims, chunks in conn.execute(
            "select hypertable_name, num_dimensions, num_chunks from timescaledb_information.hypertables order by 1"
        ):
            print(f"  {name}  dims={dims} chunks={chunks}")
        print("continuous aggregates:")
        for name, mat_only, finalized in conn.execute(
            "select view_name, materialized_only, finalized from timescaledb_information.continuous_aggregates order by 1"
        ):
            print(f"  {name}  materialized_only={mat_only} finalized={finalized}")
        print("row counts:")
        for t in ("contact_events", "vitals", "clock_history"):
            (n,) = conn.execute(f"select count(*) from {t}").fetchone()
            print(f"  {t}: {n}")


def main(argv: list[str]) -> int:
    url = get_settings().tiger_database_url
    if not url:
        print("TIGER_DATABASE_URL is empty: put the Tiger Data connection string in .env (see .env.example)")
        return 2
    print(f"migrations in {MIGRATIONS_DIR}:")
    apply(url, dry_run="--dry-run" in argv)
    if "--show" in argv:
        show(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
