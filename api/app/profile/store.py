"""profiles persistence: Tiger Data when TIGER_DATABASE_URL is set, memory otherwise."""
import logging
import threading
from datetime import date
from typing import Protocol

from ..config import Settings
from .schema import Profile

log = logging.getLogger("scallion.profile")


class ProfileStore(Protocol):
    name: str

    def get(self, user_id: str) -> Profile: ...
    def set_verified(self, user_id: str, birthdate: date | None, inquiry_id: str) -> Profile: ...
    def set_lang(self, user_id: str, lang: str) -> Profile: ...
    def set_answers(self, user_id: str, answers: dict) -> Profile: ...
    def set_backboard(self, user_id: str, assistant_id: str) -> Profile: ...


class MemoryProfileStore:
    name = "memory"

    def __init__(self) -> None:
        self._rows: dict[str, Profile] = {}
        self._lock = threading.Lock()

    def get(self, user_id: str) -> Profile:
        return self._rows.get(user_id) or Profile(user_id=user_id)

    def set_verified(self, user_id: str, birthdate: date | None, inquiry_id: str) -> Profile:
        with self._lock:
            p = self.get(user_id).model_copy(update={"verified": True, "birthdate": birthdate, "inquiry_id": inquiry_id})
            self._rows[user_id] = p
            return p

    def set_lang(self, user_id: str, lang: str) -> Profile:
        with self._lock:
            p = self.get(user_id).model_copy(update={"lang": lang})
            self._rows[user_id] = p
            return p

    def set_answers(self, user_id: str, answers: dict) -> Profile:
        with self._lock:
            p = self.get(user_id)
            p = p.model_copy(update={"answers": {**(p.answers or {}), **answers}})
            self._rows[user_id] = p
            return p

    def set_backboard(self, user_id: str, assistant_id: str) -> Profile:
        with self._lock:
            p = self.get(user_id).model_copy(update={"backboard_assistant_id": assistant_id})
            self._rows[user_id] = p
            return p

    def clear(self) -> None:
        self._rows.clear()


class PgProfileStore:
    name = "tiger"

    def __init__(self, url: str) -> None:
        from psycopg_pool import ConnectionPool

        self._pool = ConnectionPool(url, min_size=1, max_size=4, open=True, kwargs={"autocommit": True})

    def get(self, user_id: str) -> Profile:
        with self._pool.connection() as conn:
            row = conn.execute(
                "select verified, birthdate, lang, inquiry_id, answers, backboard_assistant_id from profiles where user_id = %s", (user_id,)
            ).fetchone()
        if row is None:
            return Profile(user_id=user_id)
        return Profile(user_id=user_id, verified=row[0], birthdate=row[1], lang=row[2], inquiry_id=row[3], answers=row[4] or {}, backboard_assistant_id=row[5])

    def set_verified(self, user_id: str, birthdate: date | None, inquiry_id: str) -> Profile:
        with self._pool.connection() as conn:
            conn.execute(
                "insert into profiles (user_id, verified, birthdate, inquiry_id) values (%s, true, %s, %s)"
                " on conflict (user_id) do update set verified = true, birthdate = excluded.birthdate,"
                " inquiry_id = excluded.inquiry_id, updated_at = now()",
                (user_id, birthdate, inquiry_id),
            )
        return self.get(user_id)

    def set_lang(self, user_id: str, lang: str) -> Profile:
        with self._pool.connection() as conn:
            conn.execute(
                "insert into profiles (user_id, lang) values (%s, %s)"
                " on conflict (user_id) do update set lang = excluded.lang, updated_at = now()",
                (user_id, lang),
            )
        return self.get(user_id)

    def set_answers(self, user_id: str, answers: dict) -> Profile:
        import json

        with self._pool.connection() as conn:
            conn.execute(
                "insert into profiles (user_id, answers) values (%s, %s::jsonb)"
                " on conflict (user_id) do update set answers = profiles.answers || excluded.answers, updated_at = now()",
                (user_id, json.dumps(answers)),
            )
        return self.get(user_id)

    def set_backboard(self, user_id: str, assistant_id: str) -> Profile:
        with self._pool.connection() as conn:
            conn.execute(
                "insert into profiles (user_id, backboard_assistant_id) values (%s, %s)"
                " on conflict (user_id) do update set backboard_assistant_id = excluded.backboard_assistant_id, updated_at = now()",
                (user_id, assistant_id),
            )
        return self.get(user_id)


def build_store(settings: Settings) -> ProfileStore:
    if settings.tiger_database_url:
        return PgProfileStore(settings.tiger_database_url)
    log.warning("TIGER_DATABASE_URL is empty: profiles are kept in memory and lost on restart")
    return MemoryProfileStore()
