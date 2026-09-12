import datetime as dt

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import CurrentUser
from app.config import Settings, get_settings

SECRET = "test-secret-for-hs256-only-at-least-32-bytes"


def _app(**overrides) -> TestClient:
    app = FastAPI()

    @app.get("/whoami")
    def whoami(user: CurrentUser):
        return {"id": user.id, "email": user.email}

    kw = {"gemini_fake": True, "supabase_jwt_secret": SECRET, "dev_auth_bypass": False, **overrides}
    app.dependency_overrides[get_settings] = lambda: Settings(**kw)
    return TestClient(app)


def _token(**claims) -> str:
    base = {
        "sub": "11111111-2222-4333-8444-555555555555",
        "email": "person@example.com",
        "aud": "authenticated",
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5),
    }
    base.update(claims)
    return jwt.encode(base, SECRET, algorithm="HS256")


def test_missing_token_is_401():
    assert _app().get("/whoami").status_code == 401


def test_valid_token():
    r = _app().get("/whoami", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 200
    assert r.json()["email"] == "person@example.com"


def test_wrong_secret_is_401():
    bad = jwt.encode({"sub": "x", "aud": "authenticated", "exp": 9999999999}, "other", algorithm="HS256")
    assert _app().get("/whoami", headers={"Authorization": f"Bearer {bad}"}).status_code == 401


def test_expired_is_401():
    t = _token(exp=dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1))
    assert _app().get("/whoami", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_wrong_audience_is_401():
    t = _token(aud="anon")
    assert _app().get("/whoami", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_bypass_returns_dev_user():
    r = _app(dev_auth_bypass=True).get("/whoami")
    assert r.status_code == 200
    assert r.json()["email"] == "dev@scallion.local"


def test_unconfigured_secret_is_503():
    r = _app(supabase_jwt_secret="").get("/whoami", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 503
