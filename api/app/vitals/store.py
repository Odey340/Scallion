"""Vitals persistence. Tiger Data when TIGER_DATABASE_URL is set, memory otherwise (tests, offline demo)."""
import logging
import threading
from datetime import datetime, timezone
from typing import Protocol

from ..config import Settings
from .schema import VitalsIn, VitalsOut

log = logging.getLogger("scallion.vitals")

COLUMNS = ("source", "pulse_bpm", "breathing_bpm", "stress_index", "captured_at", "hrv_rmssd_ms", "confidence", "samples")


class VitalsStore(Protocol):
    name: str

    def insert(self, user_id: str, v: VitalsIn) -> VitalsOut: ...
    def latest(self, user_id: str) -> VitalsOut | None: ...


class MemoryVitalsStore:
    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, list[VitalsOut]] = {}
        self._lock = threading.Lock()

    def insert(self, user_id: str, v: VitalsIn) -> VitalsOut:
        row = VitalsOut(**v.model_dump(), received_at=datetime.now(timezone.utc))
        with self._lock:
            self._rows.setdefault(user_id, []).append(row)
        return row

    def latest(self, user_id: str) -> VitalsOut | None:
        rows = self._rows.get(user_id, [])
        return max(rows, key=lambda r: r.captured_at) if rows else None

    def clear(self) -> None:
        self._rows.clear()


class PgVitalsStore:
    name = "tiger"

    def __init__(self, url: str) -> None:
        from psycopg_pool import ConnectionPool

        self._pool = ConnectionPool(url, min_size=1, max_size=4, open=True, kwargs={"autocommit": True})

    def insert(self, user_id: str, v: VitalsIn) -> VitalsOut:
        cols = ", ".join(("user_id", *COLUMNS))
        params = ", ".join(["%s"] * (len(COLUMNS) + 1))
        with self._pool.connection() as conn:
            (received_at,) = conn.execute(
                f"insert into vitals ({cols}) values ({params}) returning received_at",
                (user_id, *(getattr(v, c) for c in COLUMNS)),
            ).fetchone()
        return VitalsOut(**v.model_dump(), received_at=received_at)

    def latest(self, user_id: str) -> VitalsOut | None:
        cols = ", ".join((*COLUMNS, "received_at"))
        with self._pool.connection() as conn:
            row = conn.execute(
                f"select {cols} from vitals where user_id = %s order by captured_at desc limit 1", (user_id,)
            ).fetchone()
        if row is None:
            return None
        return VitalsOut(**dict(zip((*COLUMNS, "received_at"), row)))


def build_store(settings: Settings) -> VitalsStore:
    if settings.tiger_database_url:
        return PgVitalsStore(settings.tiger_database_url)
    log.warning("TIGER_DATABASE_URL is empty: vitals are kept in memory and lost on restart")
    return MemoryVitalsStore()
