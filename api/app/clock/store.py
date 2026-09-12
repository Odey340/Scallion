"""clock_history persistence: Tiger Data when TIGER_DATABASE_URL is set, memory otherwise."""
import json
import logging
import threading
from datetime import datetime, timezone
from typing import Protocol

from ..config import Settings
from .schema import ClockIn, ClockOut

log = logging.getLogger("scallion.clock")


class ClockStore(Protocol):
    name: str

    def insert(self, user_id: str, c: ClockIn) -> ClockOut: ...
    def latest(self, user_id: str) -> dict[str, ClockOut]: ...  # clock -> newest row


class MemoryClockStore:
    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, list[ClockOut]] = {}
        self._lock = threading.Lock()

    def insert(self, user_id: str, c: ClockIn) -> ClockOut:
        row = ClockOut(**c.model_dump(), computed_at=datetime.now(timezone.utc))
        with self._lock:
            self._rows.setdefault(user_id, []).append(row)
        return row

    def latest(self, user_id: str) -> dict[str, ClockOut]:
        out: dict[str, ClockOut] = {}
        for r in self._rows.get(user_id, []):
            if r.clock not in out or r.computed_at >= out[r.clock].computed_at:
                out[r.clock] = r
        return out

    def clear(self) -> None:
        self._rows.clear()


class PgClockStore:
    name = "tiger"

    def __init__(self, url: str) -> None:
        from psycopg_pool import ConnectionPool

        self._pool = ConnectionPool(url, min_size=1, max_size=4, open=True, kwargs={"autocommit": True})

    def insert(self, user_id: str, c: ClockIn) -> ClockOut:
        with self._pool.connection() as conn:
            (computed_at,) = conn.execute(
                "insert into clock_history (user_id, clock, years, chronological_age, band, inputs, engine_version)"
                " values (%s, %s, %s, %s, %s, %s, %s) returning computed_at",
                (user_id, c.clock, c.years, c.chronological_age, c.band,
                 json.dumps(c.inputs) if c.inputs is not None else None, c.engine_version),
            ).fetchone()
        return ClockOut(**c.model_dump(), computed_at=computed_at)

    def latest(self, user_id: str) -> dict[str, ClockOut]:
        with self._pool.connection() as conn:
            rows = conn.execute(
                "select distinct on (clock) clock, years, chronological_age, band, inputs, engine_version, computed_at"
                " from clock_history where user_id = %s order by clock, computed_at desc",
                (user_id,),
            ).fetchall()
        return {
            r[0]: ClockOut(clock=r[0], years=r[1], chronological_age=r[2], band=r[3], inputs=r[4], engine_version=r[5], computed_at=r[6])
            for r in rows
        }


def build_store(settings: Settings) -> ClockStore:
    if settings.tiger_database_url:
        return PgClockStore(settings.tiger_database_url)
    log.warning("TIGER_DATABASE_URL is empty: clock history is kept in memory and lost on restart")
    return MemoryClockStore()
