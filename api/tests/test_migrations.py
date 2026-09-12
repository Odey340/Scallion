"""Offline checks on api/migrations: numbering, idempotence guards and the contract objects."""
import importlib.util
from pathlib import Path

import pytest

MIG = Path(__file__).resolve().parents[1] / "migrations"


def _load_apply():
    spec = importlib.util.spec_from_file_location("apply", MIG / "apply.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_files_are_numbered_without_gaps():
    files = _load_apply().migration_files()
    assert [p.name[:4] for p in files] == ["0001", "0002", "0003", "0004", "0005", "0006", "0007"]


@pytest.mark.parametrize(
    "name, needles",
    [
        ("0001_contact_events.sql", ["create extension if not exists timescaledb", "create table if not exists contact_events",
                                     "create_hypertable('contact_events', 'ts'", "len_bucket", "contact_events_dedup"]),
        ("0002_daily_connection.sql", ["timescaledb.continuous", "time_bucket('1 day', ts)", "count(distinct contact_hash) as people",
                                       "add_continuous_aggregate_policy"]),
        ("0003_vitals.sql", ["create table if not exists vitals", "create_hypertable('vitals', 'captured_at'",
                             "pulse_bpm", "breathing_bpm", "stress_index"]),
        ("0004_clock_history.sql", ["create table if not exists clock_history", "create_hypertable('clock_history', 'computed_at'",
                                    "'phenoage', 'fitness', 'social_risk'"]),
        ("0005_daily_connection_realtime.sql", ["timescaledb.materialized_only = false"]),
        ("0006_profiles.sql", ["create table if not exists profiles", "verified", "birthdate", "user_id     uuid        primary key"]),
        ("0007_profile_answers.sql", ["add column if not exists answers jsonb"]),
    ],
)
def test_migration_contains_contract_objects(name, needles):
    sql = (MIG / name).read_text(encoding="utf-8").lower()
    for n in needles:
        assert n.lower() in sql, (name, n)


def test_every_migration_is_rerunnable():
    for p in MIG.glob("*.sql"):
        sql = p.read_text(encoding="utf-8").lower()
        assert "if not exists" in sql or "if exists" in sql, p.name
        assert "drop " not in sql, p.name


def test_apply_without_url_exits_2(monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("TIGER_DATABASE_URL", "")
    get_settings.cache_clear()
    try:
        assert _load_apply().main([]) == 2
    finally:
        get_settings.cache_clear()
