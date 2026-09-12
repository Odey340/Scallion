"""Settings, read from the environment (or a .env file next to the repo root)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = API_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(REPO_DIR / ".env", API_DIR / ".env"), extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"  # 2.5-flash returns 404 "no longer available to new users" (Sat H8)
    gemini_fake: bool = False

    supabase_jwt_secret: str = ""
    dev_auth_bypass: bool = False

    web_origin: str = "http://localhost:8081"
    max_upload_mb: int = 15

    # ElevenLabs (GET /tts and, later, the coach). Fake = silent MP3 for tests and offline demos.
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    elevenlabs_fake: bool = False

    # Persona (webhook signature, hosted-flow link). Empty secret = webhook answers 503.
    persona_webhook_secret: str = ""
    persona_template_id: str = ""
    persona_environment_id: str = ""

    # Tiger Data (TimescaleDB). Empty = in-memory stores (tests, offline demo fallback).
    tiger_database_url: str = ""

    # Where A's exports land. Falls back to the contract-shaped copy in api/fixtures.
    engine_dir: Path = REPO_DIR / "web" / "public" / "engine"

    @property
    def phenoage_path(self) -> Path:
        live = self.engine_dir / "phenoage.json"
        if live.exists():
            return live
        # TODO(A): remove the fallback once matlab/export writes web/public/engine/phenoage.json
        return API_DIR / "fixtures" / "phenoage.contract.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
