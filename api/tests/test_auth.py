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

    kw = {"gemini_fake": True, "supabase_jwt_secret": SECRET, "supabase_url": "", "dev_auth_bypass": False, **overrides}
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


# ---- asymmetric (ES256) tokens verified against the project's JWKS ----

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from jwt import PyJWKClient  # noqa: E402
from jwt.algorithms import ECAlgorithm  # noqa: E402

import app.auth as auth_mod  # noqa: E402

SUPABASE_URL = "https://example.supabase.co"
_EC_KEY = ec.generate_private_key(ec.SECP256R1())
_EC_PEM = _EC_KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
)
_KID = "kid-es256-1"


def _jwks_app(monkeypatch, **overrides) -> TestClient:
    jwk = ECAlgorithm.to_jwk(_EC_KEY.public_key(), as_dict=True) | {"kid": _KID, "alg": "ES256", "use": "sig"}
    monkeypatch.setattr(PyJWKClient, "fetch_data", lambda self: {"keys": [jwk]})
    auth_mod._jwks_clients.clear()
    return _app(supabase_url=SUPABASE_URL, **overrides)


def _es_token(**claims) -> str:
    base = {
        "sub": "11111111-2222-4333-8444-555555555555",
        "email": "person@example.com",
        "aud": "authenticated",
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5),
    }
    base.update(claims)
    return jwt.encode(base, _EC_PEM, algorithm="ES256", headers={"kid": _KID})


def test_es256_token_via_jwks(monkeypatch):
    r = _jwks_app(monkeypatch).get("/whoami", headers={"Authorization": f"Bearer {_es_token()}"})
    assert r.status_code == 200
    assert r.json()["email"] == "person@example.com"


def test_hs256_still_works_when_jwks_configured(monkeypatch):
    r = _jwks_app(monkeypatch).get("/whoami", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 200


def test_es256_without_supabase_url_is_401_not_500():
    r = _app().get("/whoami", headers={"Authorization": f"Bearer {_es_token()}"})
    assert r.status_code == 401
    assert "InvalidAlgorithmError" in r.json()["detail"]


def test_es256_unknown_kid_is_401(monkeypatch):
    other = ec.generate_private_key(ec.SECP256R1())
    pem = other.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    t = jwt.encode({"sub": "x", "aud": "authenticated", "exp": 9999999999}, pem, algorithm="ES256", headers={"kid": "nope"})
    assert _jwks_app(monkeypatch).get("/whoami", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_es256_wrong_audience_is_401(monkeypatch):
    t = _es_token(aud="anon")
    assert _jwks_app(monkeypatch).get("/whoami", headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_jwks_only_config_accepts_es256_and_rejects_hs256(monkeypatch):
    c = _jwks_app(monkeypatch, supabase_jwt_secret="")
    assert c.get("/whoami", headers={"Authorization": f"Bearer {_es_token()}"}).status_code == 200
    assert c.get("/whoami", headers={"Authorization": f"Bearer {_token()}"}).status_code == 401


def test_garbage_token_is_401():
    assert _app().get("/whoami", headers={"Authorization": "Bearer not.a.jwt"}).status_code == 401
