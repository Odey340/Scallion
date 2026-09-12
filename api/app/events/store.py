"""contact_events persistence: Tiger Data when TIGER_DATABASE_URL is set, memory otherwise.
Inserts are idempotent (unique index contact_events_dedup); re-sending a batch inserts nothing."""
import logging
import threading
from typing import Protocol

from ..config import Settings
from .schema import Event

log = logging.getLogger("scallion.events")


class EventsStore(Protocol):
    name: str

    def insert(self, user_id: str, events: list[Event]) -> int: ...
    def delete(self, user_id: str, contact: str | None = None) -> int: ...
    def count(self, user_id: str) -> int: ...
    def all(self, user_id: str, since_days: int = 400) -> list[Event]: ...


def _key(e: Event) -> tuple:
    return (e.contact, e.ts, e.app, e.dir)


class MemoryEventsStore:
    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, dict[tuple, Event]] = {}
        self._lock = threading.Lock()

    def insert(self, user_id: str, events: list[Event]) -> int:
        with self._lock:
            rows = self._rows.setdefault(user_id, {})
            before = len(rows)
            for e in events:
                rows.setdefault(_key(e), e)
            return len(rows) - before

    def delete(self, user_id: str, contact: str | None = None) -> int:
        with self._lock:
            rows = self._rows.get(user_id, {})
            if contact is None:
                n = len(rows)
                self._rows.pop(user_id, None)
                return n
            doomed = [k for k in rows if k[0] == contact]
            for k in doomed:
                del rows[k]
            return len(doomed)

    def count(self, user_id: str) -> int:
        return len(self._rows.get(user_id, {}))

    def all(self, user_id: str, since_days: int = 400) -> list[Event]:
        from datetime import datetime, timedelta, timezone

        cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
        return sorted((e for e in self._rows.get(user_id, {}).values() if (e.ts if e.ts.tzinfo else e.ts.replace(tzinfo=timezone.utc)) >= cutoff), key=lambda e: e.ts)

    def clear(self) -> None:
        self._rows.clear()


class PgEventsStore:
    name = "tiger"

    def __init__(self, url: str) -> None:
        from psycopg_pool import ConnectionPool

        self._pool = ConnectionPool(url, min_size=1, max_size=4, open=True, kwargs={"autocommit": True})

    def insert(self, user_id: str, events: list[Event]) -> int:
        if not events:
            return 0
        cols = list(zip(*[(e.ts, e.contact, e.app, e.dir, e.len) for e in events]))
        with self._pool.connection() as conn:
            cur = conn.execute(
                "insert into contact_events (user_id, ts, contact_hash, app, dir, len_bucket) "
                "select %s, * from unnest(%s::timestamptz[], %s::text[], %s::text[], %s::text[], %s::smallint[]) "
                "on conflict do nothing",
                (user_id, list(cols[0]), list(cols[1]), list(cols[2]), list(cols[3]), list(cols[4])),
            )
            return cur.rowcount

    def delete(self, user_id: str, contact: str | None = None) -> int:
        with self._pool.connection() as conn:
            if contact is None:
                cur = conn.execute("delete from contact_events where user_id = %s", (user_id,))
            else:
                cur = conn.execute("delete from contact_events where user_id = %s and contact_hash = %s", (user_id, contact))
            return cur.rowcount

    def count(self, user_id: str) -> int:
        with self._pool.connection() as conn:
            (n,) = conn.execute("select count(*) from contact_events where user_id = %s", (user_id,)).fetchone()
            return n

    def all(self, user_id: str, since_days: int = 400) -> list[Event]:
        with self._pool.connection() as conn:
            rows = conn.execute(
                "select contact_hash, ts, app, dir, len_bucket from contact_events"
                " where user_id = %s and ts >= now() - make_interval(days => %s) order by ts",
                (user_id, since_days),
            ).fetchall()
        return [Event(contact=r[0], ts=r[1], app=r[2], dir=r[3], len=r[4]) for r in rows]


def build_store(settings: Settings) -> EventsStore:
    if settings.tiger_database_url:
        return PgEventsStore(settings.tiger_database_url)
    log.warning("TIGER_DATABASE_URL is empty: contact events are kept in memory and lost on restart")
    return MemoryEventsStore()
