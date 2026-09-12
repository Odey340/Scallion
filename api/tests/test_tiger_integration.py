"""Runs only when TIGER_DATABASE_URL is set: applies the migrations to the real Tiger Data
service and round-trips one row through every table. Safe to re-run; it cleans up after itself."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

URL = os.environ.get("TIGER_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="TIGER_DATABASE_URL not set")


@pytest.fixture(scope="module")
def conn():
    import psycopg

    from tests.test_migrations import _load_apply

    _load_apply().apply(URL)
    with psycopg.connect(URL, autocommit=True) as c:
        yield c


def test_objects_exist(conn):
    tables = {r[0] for r in conn.execute("select table_name from information_schema.tables where table_schema='public'")}
    assert {"contact_events", "vitals", "clock_history", "schema_migrations"} <= tables
    hyper = {r[0] for r in conn.execute("select hypertable_name from timescaledb_information.hypertables")}
    assert {"contact_events", "vitals", "clock_history"} <= hyper
    caggs = {r[0] for r in conn.execute("select view_name from timescaledb_information.continuous_aggregates")}
    assert "daily_connection" in caggs


def test_contact_events_dedup_and_daily_connection(conn):
    user = uuid.uuid4()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    rows = [(user, now - timedelta(hours=h), f"hash{h % 3}", "gmail", "in" if h % 2 else "out", 1) for h in range(6)]
    try:
        for _ in range(2):  # the second pass must be a no-op
            conn.cursor().executemany(
                "insert into contact_events (user_id, ts, contact_hash, app, dir, len_bucket) values (%s,%s,%s,%s,%s,%s)"
                " on conflict do nothing",
                rows,
            )
        (n,) = conn.execute("select count(*) from contact_events where user_id=%s", (user,)).fetchone()
        assert n == 6
        people = conn.execute(
            "select sum(people) from daily_connection where user_id=%s", (user,)
        ).fetchone()[0]
        assert people >= 3  # real-time aggregation: rows newer than the policy window are computed on read
    finally:
        conn.execute("delete from contact_events where user_id=%s", (user,))


def test_vitals_and_clock_history_roundtrip(conn):
    user = uuid.uuid4()
    now = datetime.now(timezone.utc)
    try:
        conn.execute(
            "insert into vitals (user_id, captured_at, source, pulse_bpm, breathing_bpm, stress_index) values (%s,%s,'presage',62,14,98)",
            (user, now),
        )
        row = conn.execute(
            "select pulse_bpm, breathing_bpm, stress_index from vitals where user_id=%s order by captured_at desc limit 1", (user,)
        ).fetchone()
        assert row == (62.0, 14.0, 98.0)
        conn.execute(
            "insert into clock_history (user_id, clock, years, chronological_age, band, inputs, engine_version)"
            " values (%s,'phenoage',41.3,34,2.4,'{\"rdw\":13.1}','1')",
            (user,),
        )
        (years,) = conn.execute("select years from clock_history where user_id=%s", (user,)).fetchone()
        assert abs(years - 41.3) < 1e-4
    finally:
        conn.execute("delete from vitals where user_id=%s", (user,))
        conn.execute("delete from clock_history where user_id=%s", (user,))


def test_pg_vitals_store_roundtrip(conn):
    from app.vitals.schema import VitalsIn
    from app.vitals.store import PgVitalsStore

    user = str(uuid.uuid4())
    store = PgVitalsStore(URL)
    try:
        store.insert(user, VitalsIn(pulse_bpm=70, captured_at=datetime(2026, 9, 12, 15, tzinfo=timezone.utc)))
        store.insert(user, VitalsIn(pulse_bpm=60, breathing_bpm=14, captured_at=datetime(2026, 9, 12, 13, tzinfo=timezone.utc)))
        row = store.latest(user)
        assert row is not None and row.pulse_bpm == 70 and row.received_at is not None
        assert store.latest(str(uuid.uuid4())) is None
    finally:
        conn.execute("delete from vitals where user_id=%s", (user,))
