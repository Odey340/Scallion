"""Backboard memory mirror. One Backboard assistant per Scallion user (memories are scoped per
assistant); every check-in becomes a memory; recall is a semantic search over them.
No LLM answer is generated here: the coach speaks only from our context (CLAUDE.md rule 1)."""
import logging
import threading
from typing import Protocol

from ..config import Settings

log = logging.getLogger("scallion.backboard")
BASE = "https://app.backboard.io/api"


class Memory(Protocol):
    name: str

    def remember(self, user_id: str, text: str, metadata: dict | None = None) -> None: ...
    def recall(self, user_id: str, query: str, limit: int = 5) -> list[dict]: ...


class BackboardMemory:
    name = "backboard"

    def __init__(self, api_key: str, assistant_ids: "AssistantIds"):
        import httpx

        self._client = httpx.Client(base_url=BASE, headers={"X-API-Key": api_key}, timeout=20)
        self._ids = assistant_ids

    def _assistant(self, user_id: str) -> str:
        aid = self._ids.get(user_id)
        if aid:
            return aid
        r = self._client.post("/assistants", json={
            "name": f"scallion-{user_id}",
            "description": "Scallion coach memory for one user: check-ins, plans, nudges, meals. No PHI beyond what the user typed.",
        })
        r.raise_for_status()
        aid = r.json().get("assistant_id") or r.json().get("id")
        self._ids.set(user_id, aid)
        return aid

    def remember(self, user_id: str, text: str, metadata: dict | None = None) -> None:
        def _go() -> None:
            try:
                aid = self._assistant(user_id)
                # Backboard returns 500 for most metadata shapes; the kind lives in the text instead.
                self._client.post(f"/assistants/{aid}/memories", json={"content": text}).raise_for_status()
            except Exception as e:  # memory is best-effort; the Postgres table is the record
                log.warning("backboard remember failed: %s", e.__class__.__name__)

        threading.Thread(target=_go, daemon=True).start()

    def recall(self, user_id: str, query: str, limit: int = 5) -> list[dict]:
        aid = self._ids.get(user_id)
        if not aid:
            return []
        r = self._client.post(f"/assistants/{aid}/memories/search", json={"query": query, "limit": limit})
        r.raise_for_status()
        return [{"content": m.get("content"), "score": m.get("score"), "created_at": m.get("created_at")} for m in r.json().get("memories", [])]


class NoMemory:
    """No key: the checkins table is the only memory (cut order fallback)."""

    name = "table"

    def remember(self, user_id: str, text: str, metadata: dict | None = None) -> None:
        return None

    def recall(self, user_id: str, query: str, limit: int = 5) -> list[dict]:
        return []


class AssistantIds(Protocol):
    def get(self, user_id: str) -> str | None: ...
    def set(self, user_id: str, assistant_id: str) -> None: ...


def build_memory(settings: Settings, assistant_ids: AssistantIds) -> Memory:
    if settings.backboard_api_key:
        return BackboardMemory(settings.backboard_api_key, assistant_ids)
    log.warning("BACKBOARD_API_KEY is empty: coach memory is the checkins table only")
    return NoMemory()
