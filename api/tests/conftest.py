import os

os.environ["GEMINI_FAKE"] = "1"
os.environ["DEV_AUTH_BYPASS"] = "1"
os.environ["GEMINI_API_KEY"] = ""

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
