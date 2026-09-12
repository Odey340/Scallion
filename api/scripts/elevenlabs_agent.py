"""Create or update the Scallion coach agent on ElevenLabs from api/coach_tools.json.

    uv run python scripts/elevenlabs_agent.py            # create (or update ELEVENLABS_AGENT_ID if set)
    uv run python scripts/elevenlabs_agent.py --agent agent_xxx

Prints the agent id; put it in .env as ELEVENLABS_AGENT_ID. English by default, Spanish via a
language preset; voice from ELEVENLABS_VOICE_ID (Sarah) on the multilingual turbo model.
"""
import json
import sys
from pathlib import Path

import httpx

API_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))
from app.config import get_settings  # noqa: E402
from app.tts import DEFAULT_VOICE  # noqa: E402

BASE = "https://api.elevenlabs.io/v1/convai"
FIRST_EN = "Hi, I'm your Scallion coach. I can explain your biological age, your circle, or today's one action. Where do you want to start?"
FIRST_ES = "Hola, soy tu coach de Scallion. Puedo explicarte tu edad biológica, tu círculo o la acción de hoy. ¿Por dónde empezamos?"


def _params(p: dict, tool_name: str) -> dict:
    """ElevenLabs requires a description on every property."""
    props = {k: {**v, "description": v.get("description") or f"{k} for {tool_name}"} for k, v in p.get("properties", {}).items()}
    return {**p, "properties": props}


def build_config(tools_json: dict, voice_id: str) -> dict:
    client_tools = [
        {
            "type": "client",
            "name": t["name"],
            "description": t["description"],
            "parameters": _params(t["parameters"], t["name"]),
            "expects_response": True,
        }
        for t in tools_json["tools"]
    ]
    return {
        "name": "Scallion coach",
        "conversation_config": {
            "agent": {
                "first_message": FIRST_EN,
                "language": "en",
                "prompt": {
                    "prompt": tools_json["system_prompt"],
                    "temperature": 0.2,
                    "tools": client_tools,
                },
            },
            "tts": {"voice_id": voice_id, "model_id": "eleven_turbo_v2"},  # English agents must use turbo/flash v2
            "language_presets": {
                "es": {"overrides": {"agent": {"first_message": FIRST_ES, "language": "es"}, "tts": {"voice_id": voice_id, "model_id": "eleven_turbo_v2_5"}}}
            },
        },
    }


def main(argv: list[str]) -> int:
    s = get_settings()
    if not s.elevenlabs_api_key:
        print("ELEVENLABS_API_KEY missing")
        return 2
    agent_id = argv[argv.index("--agent") + 1] if "--agent" in argv else s.elevenlabs_agent_id
    tools_json = json.loads((API_DIR / "coach_tools.json").read_text(encoding="utf-8"))
    body = build_config(tools_json, s.elevenlabs_voice_id or DEFAULT_VOICE)
    headers = {"xi-api-key": s.elevenlabs_api_key}
    with httpx.Client(timeout=60) as c:
        if agent_id:
            r = c.patch(f"{BASE}/agents/{agent_id}", headers=headers, json=body)
            action = "updated"
        else:
            r = c.post(f"{BASE}/agents/create", headers=headers, json=body)
            action = "created"
        if r.status_code >= 400:
            print(action, "failed:", r.status_code, r.text[:800])
            return 1
        data = r.json()
        agent_id = data.get("agent_id", agent_id)
        print(f"{action} agent {agent_id}")
        got = c.get(f"{BASE}/agents/{agent_id}", headers=headers).json()
        cfg = got.get("conversation_config", {})
        tools = cfg.get("agent", {}).get("prompt", {}).get("tools") or cfg.get("agent", {}).get("prompt", {}).get("tool_ids") or []
        print("name:", got.get("name"), "| language:", cfg.get("agent", {}).get("language"), "| presets:", list(cfg.get("language_presets", {}).keys()),
              "| tools:", [t.get("name", t) if isinstance(t, dict) else t for t in tools], "| voice:", cfg.get("tts", {}).get("voice_id"), cfg.get("tts", {}).get("model_id"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
