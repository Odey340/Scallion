"""checkins persistence: Tiger Data when TIGER_DATABASE_URL is set, memory otherwise.
TODO(D): mirror to Backboard when BACKBOARD_API_KEY exists (cut order: Postgres table is the fallback)."""
import json
import logging
import threading
from datetime import datetime, timezone
from typing import Protocol

from ..config import Settings
from .schema import CheckinIn, CheckinOut

log = logging.getLogger("scallion.checkins")


class CheckinStore(Protocol):
    name: str

    def insert(self, user_id: str, c: CheckinIn, ts: datetime | None = None) -> CheckinOut: ...
    def recent(self, user_id: str, limit: int = 10, kind: str | None = None) -> list[CheckinOut]: ...


class MemoryCheckinStore:
    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, list[CheckinOut]] = {}
        self._next = 1
        self._lock = threading.Lock()

    def insert(self, user_id: str, c: CheckinIn, ts: datetime | None = None) -> CheckinOut:
        with self._lock:
            row = CheckinOut(**c.model_dump(), id=self._next, ts=ts or datetime.now(timezone.utc))
            self._next += 1
            self._rows.setdefault(user_id, []).append(row)
            return row

    def recent(self, user_id: str, limit: int = 10, kind: str | None = None) -> list[CheckinOut]:
        rows = [r for r in self._rows.get(user_id, []) if kind is None or r.kind == kind]
        return sorted(rows, key=lambda r: (r.ts, r.id), reverse=True)[:limit]

    def clear(self) -> None:
        self._rows.clear()


class PgCheckinStore:
    name = "tiger"

    def __init__(self, url: str) -> None:
        from psycopg_pool import ConnectionPool

        self._pool = ConnectionPool(url, min_size=1, max_size=4, open=True, kwargs={"autocommit": True})

    def insert(self, user_id: str, c: CheckinIn, ts: datetime | None = None) -> CheckinOut:
        with self._pool.connection() as conn:
            rid, rts = conn.execute(
                "insert into checkins (user_id, ts, kind, text, data) values (%s, coalesce(%s, now()), %s, %s, %s) returning id, ts",
                (user_id, ts, c.kind, c.text, json.dumps(c.data) if c.data is not None else None),
            ).fetchone()
        return CheckinOut(**c.model_dump(), id=rid, ts=rts)

    def recent(self, user_id: str, limit: int = 10, kind: str | None = None) -> list[CheckinOut]:
        q = "select id, ts, kind, text, data from checkins where user_id = %s"
        params: list = [user_id]
        if kind:
            q += " and kind = %s"
            params.append(kind)
        q += " order by ts desc, id desc limit %s"
        params.append(limit)
        with self._pool.connection() as conn:
            rows = conn.execute(q, params).fetchall()
        return [CheckinOut(id=r[0], ts=r[1], kind=r[2], text=r[3], data=r[4]) for r in rows]


def build_store(settings: Settings) -> CheckinStore:
    if settings.tiger_database_url:
        return PgCheckinStore(settings.tiger_database_url)
    log.warning("TIGER_DATABASE_URL is empty: coach memory is kept in memory and lost on restart")
    return MemoryCheckinStore()
