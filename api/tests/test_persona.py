"""Persona webhook signature + verified/birthdate; GET /me over_65; PUT /me/lang."""
import hashlib
import hmac
import json

import httpx
import time
from datetime import date

import pytest

from app.auth import DEV_USER_ID
from app.profile.schema import age_on
from app.routes.persona import get_store, verify_signature

SECRET = "whsec_test"


def signed(body: dict, secret: str = SECRET, t: int | None = None) -> tuple[bytes, str]:
    raw = json.dumps(body).encode()
    t = t or int(time.time())
    v1 = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, f"t={t},v1={v1}"


def inquiry(name="inquiry.approved", status="approved", birthdate="1958-03-02", reference=DEV_USER_ID):
    fields = {"birthdate": {"type": "date", "value": birthdate}} if birthdate else {}
    return {"data": {"attributes": {"name": name, "payload": {"data": {
        "id": "inq_123", "type": "inquiry",
        "attributes": {"status": status, "reference-id": reference, "fields": fields},
    }}}}}


@pytest.fixture(autouse=True)
def configured(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "persona_webhook_secret", SECRET)
    monkeypatch.setattr(get_settings(), "persona_template_id", "itmpl_test")
    get_store().clear()
    yield
    get_store().clear()


def post(client, raw, sig):
    return client.post("/persona/webhook", content=raw, headers={"content-type": "application/json", "persona-signature": sig})


def test_me_before_verification(client):
    body = client.get("/me").json()
    assert body["verified"] is False and body["over_65"] is False and body["age"] is None
    assert body["verify_url"].startswith("https://inquiry.withpersona.com/verify?inquiry-template-id=itmpl_test&reference-id=")


def test_approved_webhook_sets_verified_birthdate_and_over_65(client):
    raw, sig = signed(inquiry())
    r = post(client, raw, sig)
    assert r.status_code == 200 and r.json()["applied"] is True
    me = client.get("/me").json()
    assert me["verified"] is True and me["over_65"] is True
    assert me["age"] == age_on(date(1958, 3, 2), date.today())
    assert me["verify_url"] is None


def test_selfie_only_template_has_no_birthdate(client):
    raw, sig = signed(inquiry(birthdate=None))
    assert post(client, raw, sig).json()["birthdate_present"] is False
    me = client.get("/me").json()
    assert me["verified"] is True and me["over_65"] is False and me["age"] is None


def test_under_65(client):
    raw, sig = signed(inquiry(birthdate="1992-07-14"))
    post(client, raw, sig)
    me = client.get("/me").json()
    assert me["over_65"] is False and 30 <= me["age"] <= 40


def test_declined_or_other_events_do_not_verify(client):
    for name, status in [("inquiry.declined", "declined"), ("inquiry.completed", "declined"), ("inquiry.created", "created")]:
        raw, sig = signed(inquiry(name=name, status=status))
        assert post(client, raw, sig).json()["applied"] is False
    assert client.get("/me").json()["verified"] is False


@pytest.mark.parametrize("bad", ["", "t=1,v1=deadbeef", "garbage"])
def test_bad_signatures_are_401(client, bad):
    raw, _ = signed(inquiry())
    assert post(client, raw, bad).status_code == 401


def test_wrong_secret_and_stale_timestamp(client):
    raw, sig = signed(inquiry(), secret="other")
    assert post(client, raw, sig).status_code == 401
    raw, sig = signed(inquiry(), t=int(time.time()) - 3600)
    assert post(client, raw, sig).status_code == 401


def test_unconfigured_secret_is_503():
    with pytest.raises(Exception) as e:
        verify_signature("", "t=1,v1=x", b"{}")
    assert e.value.status_code == 503


def test_set_lang(client):
    assert client.put("/me/lang", json={"lang": "es"}).json()["lang"] == "es"
    assert client.get("/me").json()["lang"] == "es"
    assert client.put("/me/lang", json={"lang": "fr"}).status_code == 422


def test_one_time_link_is_minted_with_an_api_key_and_matched_by_reference_id():
    """With PERSONA_API_KEY the server creates the inquiry (reference-id = user id) and returns
    Persona's one-time link; no environment id is needed."""
    from app.config import Settings
    from app.routes.persona import mint_one_time_link

    seen: list[tuple[str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        seen.append((request.url.path, body))
        assert request.headers["authorization"] == "Bearer persona_sandbox_test"
        if request.url.path == "/api/v1/inquiries":
            return httpx.Response(201, json={"data": {"id": "inq_test", "attributes": {"reference-id": body["data"]["attributes"]["reference-id"]}}})
        if request.url.path == "/api/v1/inquiries/inq_test/generate-one-time-link":
            return httpx.Response(200, json={"meta": {"one-time-link": "https://withpersona.com/verify?code=abc"}})
        return httpx.Response(404)

    settings = Settings(persona_template_id="itmpl_test", persona_api_key="persona_sandbox_test")
    client = httpx.Client(base_url="https://api.withpersona.com/api/v1", transport=httpx.MockTransport(handler))
    link = mint_one_time_link(settings, "user-123", client=client)
    assert link == "https://withpersona.com/verify?code=abc"
    assert seen[0][1]["data"]["attributes"] == {"inquiry-template-id": "itmpl_test", "reference-id": "user-123"}


def test_verify_url_falls_back_to_the_template_link_when_persona_is_unreachable(monkeypatch):
    from app.config import Settings
    from app.routes import persona as mod

    monkeypatch.setattr(mod, "mint_one_time_link", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    mod._links.clear()
    settings = Settings(persona_template_id="itmpl_test", persona_api_key="persona_sandbox_test", persona_environment_id="env_x")
    url = mod._verify_url(settings, "user-123")
    assert url == "https://inquiry.withpersona.com/verify?inquiry-template-id=itmpl_test&reference-id=user-123&environment-id=env_x"
