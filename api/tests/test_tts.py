"""GET /tts with the fake synth (ELEVENLABS_FAKE=1 in conftest)."""
import pytest

from app.tts import FakeSynth, build_synth


def test_tts_returns_mp3(client):
    r = client.get("/tts", params={"text": "Your biological age is an estimate, not a diagnosis.", "lang": "en"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.content.startswith(b"ID3")
    assert len(r.content) > 100


def test_tts_spanish_and_limits(client):
    assert client.get("/tts", params={"text": "Conoce tu edad biologica.", "lang": "es"}).status_code == 200
    assert client.get("/tts", params={"text": "x" * 301}).status_code == 422
    assert client.get("/tts", params={"text": ""}).status_code == 422
    assert client.get("/tts", params={"text": "hi", "lang": "fr"}).status_code == 422


def test_health_reports_tts_mode(client):
    assert client.get("/health").json()["tts"] == "fake"


def test_build_synth_modes():
    from app.config import Settings

    assert build_synth(Settings(elevenlabs_fake=True)).name == "fake"
    assert build_synth(Settings(elevenlabs_fake=False, elevenlabs_api_key="")) is None
    assert isinstance(FakeSynth().speak("a", "en"), bytes)


def test_tts_503_when_unconfigured(client, monkeypatch):
    from app.routes import tts as route

    monkeypatch.setattr(route, "get_synth", lambda: None)
    r = client.get("/tts", params={"text": "hello"})
    assert r.status_code == 503
