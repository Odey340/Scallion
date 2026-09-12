"""POST /events body: B's hashed metadata events (docs/contracts.md section 2). No content, no handles."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

App = Literal["gmail", "whatsapp", "sms", "imessage", "notif"]

MAX_EVENTS_PER_REQUEST = 50_000


class Event(BaseModel):
    contact: str = Field(pattern=r"^[0-9a-f]{64}$", description="sha256(normalized handle + user salt), hex")
    ts: datetime
    app: App
    dir: Literal["in", "out"]
    len: Literal[0, 1, 2, 3]


class EventsIn(BaseModel):
    events: list[Event] = Field(max_length=MAX_EVENTS_PER_REQUEST)


class EventsOut(BaseModel):
    inserted: int
    received: int
    duplicates: int
