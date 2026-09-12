"""Narration validator (CLAUDE.md rule 1): a coach sentence may only contain numbers present in
the context JSON. Gemini and the ElevenLabs agent narrate; they never produce a displayed number."""
import re
from typing import Any

_NUM = re.compile(r"(?<![\w.])[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])[-+]?\d+(?:\.\d+)?")
# Timestamps and dates in the context (generated_at, captured_at, computed_at) must not license
# numbers like 12 or 2026 in narration.
_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}(?:[T ][\d:.+\-Z]*)?|\b\d{1,2}:\d{2}(?::\d{2})?\b")
_SKIP_KEYS = {"generated_at", "captured_at", "computed_at", "received_at", "source", "rule", "condition"}


def _forms(x: float) -> set[str]:
    out = set()
    for v in (x, abs(x)):
        out.add(f"{v:g}")
        for dp in (0, 1, 2):
            out.add(f"{round(v, dp):.{dp}f}" if dp else f"{int(round(v))}")
    return out


def allowed_numbers(context: Any) -> set[str]:
    """Every number that appears in the context, as strings, with 0/1/2-decimal roundings.
    Timestamps, citation strings and condition strings are skipped."""
    found: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, bool) or node is None:
            return
        if isinstance(node, (int, float)):
            found.update(_forms(float(node)))
        elif isinstance(node, str):
            for m in _NUM.findall(_TIMESTAMP.sub(" ", node)):
                found.update(_forms(float(m.replace(",", ""))))
        elif isinstance(node, dict):
            for k, v in node.items():
                if k not in _SKIP_KEYS:
                    walk(v)
        elif isinstance(node, (list, tuple)):
            for v in node:
                walk(v)

    walk(context)
    return found


def validate_narration(text: str, context: Any) -> dict:
    allowed = allowed_numbers(context)
    unknown: list[str] = []
    for m in _NUM.findall(text or ""):
        token = m.replace(",", "")
        if not (_forms(float(token)) & allowed):
            unknown.append(m)
    return {"ok": not unknown, "unknown_numbers": unknown, "numbers_in_context": len(allowed)}
