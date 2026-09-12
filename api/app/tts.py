"""Text-to-speech for the H10 device test and the coach's text fallback.

ElevenLabs when ELEVENLABS_API_KEY is set; a fake that returns a tiny MP3 header when
ELEVENLABS_FAKE=1 (tests, offline demo); otherwise the route answers 503.
The text is spoken as given: it must already have passed the number validator upstream.
"""
from typing import Protocol

from .config import Settings

ELEVEN_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
MODEL_ID = "eleven_multilingual_v2"  # English and Spanish from one model
DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"  # ElevenLabs premade "Sarah" (multilingual v2); override with ELEVENLABS_VOICE_ID


class Synth(Protocol):
    name: str

    def speak(self, text: str, lang: str) -> bytes: ...


class ElevenLabsSynth:
    name = "live"

    def __init__(self, settings: Settings):
        import httpx

        self._client = httpx.Client(timeout=30)
        self._key = settings.elevenlabs_api_key
        self._voice = settings.elevenlabs_voice_id or DEFAULT_VOICE

    def speak(self, text: str, lang: str) -> bytes:
        r = self._client.post(
            ELEVEN_URL.format(voice_id=self._voice),
            headers={"xi-api-key": self._key, "accept": "audio/mpeg", "content-type": "application/json"},
            params={"output_format": "mp3_44100_64"},
            json={"text": text, "model_id": MODEL_ID},  # multilingual v2 detects the language; language_code is only for flash/turbo
        )
        r.raise_for_status()
        return r.content


class FakeSynth:
    """A syntactically valid, silent-ish MP3 frame header so <audio> on a phone accepts it."""

    name = "fake"

    def speak(self, text: str, lang: str) -> bytes:
        frame = b"\xff\xfb\x90\x00" + b"\x00" * 413  # MPEG-1 Layer III, 128 kbps, 44.1 kHz, no CRC
        return b"ID3\x03\x00\x00\x00\x00\x00\x00" + frame * 4


def build_synth(settings: Settings) -> Synth | None:
    if settings.elevenlabs_fake:
        return FakeSynth()
    if settings.elevenlabs_api_key:
        return ElevenLabsSynth(settings)
    return None
