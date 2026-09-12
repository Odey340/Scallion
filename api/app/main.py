import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import events, extract, health, tts, vitals

log = logging.getLogger("scallion")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Scallion API", version=health.VERSION, docs_url="/docs")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.web_origin.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(extract.router)
    app.include_router(vitals.router)
    app.include_router(events.router)
    app.include_router(tts.router)

    if settings.dev_auth_bypass:
        log.warning("DEV_AUTH_BYPASS is on: every request runs as the dev user")
    if not settings.gemini_fake and not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is empty; set it or run with GEMINI_FAKE=1")
    return app


app = create_app()
