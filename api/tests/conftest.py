import os

os.environ["GEMINI_FAKE"] = "1"
os.environ["DEV_AUTH_BYPASS"] = "1"
os.environ["GEMINI_API_KEY"] = ""
os.environ["ELEVENLABS_FAKE"] = "1"
os.environ["BACKBOARD_API_KEY"] = ""  # unit tests never touch Backboard (test_backboard uses a fake)
os.environ["PERSONA_API_KEY"] = ""  # unit tests never mint real Persona links (test_persona uses a MockTransport)
# Unit tests run on the in-memory vitals store; the integration test gets the real URL from TIGER_TEST_URL.
TIGER_TEST_URL = os.environ.get("TIGER_DATABASE_URL", "")
os.environ["TIGER_DATABASE_URL"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import REPO_DIR, get_settings  # noqa: E402

FIXTURE_PDF = REPO_DIR / "fixtures" / "lab_report_synthetic.pdf"


@pytest.fixture(scope="session")
def client():
    get_settings.cache_clear()
    from app.main import app

    with TestClient(app) as c:
        yield c
