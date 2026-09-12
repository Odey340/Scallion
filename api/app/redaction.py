"""Reference implementation of api/redaction_rules.json.

Lane C applies the same rules in the browser (pdf.js text items); this module exists so the
rules are tested against fixtures here and so the server can assert an upload was redacted.
The regexes are written in the ECMAScript subset that Python's `re` also accepts.
"""
import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .config import API_DIR

RULES_PATH = API_DIR / "redaction_rules.json"


@dataclass(frozen=True)
class Rule:
    id: str
    category: str
    action: str  # "drop_line" | "mask"
    regex: re.Pattern


@dataclass(frozen=True)
class RuleSet:
    version: int
    keep_if: re.Pattern
    mask_token: str
    rules: tuple[Rule, ...]


@dataclass
class Redaction:
    text: str
    dropped: list[tuple[int, str, str]] = field(default_factory=list)  # (line_no, rule_id, line)
    masked: list[tuple[int, str, str]] = field(default_factory=list)  # (line_no, rule_id, match)

    @property
    def hits(self) -> int:
        return len(self.dropped) + len(self.masked)


@lru_cache
def load_rules(path: Path = RULES_PATH) -> RuleSet:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    rules = tuple(
        Rule(r["id"], r["category"], r["action"], re.compile(r["pattern"], re.IGNORECASE)) for r in raw["rules"]
    )
    return RuleSet(
        version=raw["version"],
        keep_if=re.compile(raw["keep_if"]["pattern"], re.IGNORECASE),
        mask_token=raw.get("mask_token", "[REDACTED]"),
        rules=rules,
    )


def redact_line(line: str, rs: RuleSet) -> tuple[str | None, list[str], list[tuple[str, str]]]:
    """Returns (new_line or None if dropped, drop rule ids, [(mask rule id, matched text)])."""
    is_result_row = bool(rs.keep_if.search(line))
    masks: list[tuple[str, str]] = []
    out = line
    for rule in rs.rules:
        if rule.action == "drop_line":
            if not is_result_row and rule.regex.search(out):
                return None, [rule.id], masks
        elif rule.action == "mask":
            for m in list(rule.regex.finditer(out))[::-1]:  # right to left so offsets stay valid
                masks.append((rule.id, m.group(0)))
                out = out[: m.start()] + rs.mask_token + out[m.end() :]
    return out, [], masks


def redact_text(text: str, rs: RuleSet | None = None) -> Redaction:
    rs = rs or load_rules()
    result = Redaction(text="")
    kept: list[str] = []
    for i, line in enumerate(text.split("\n")):
        new, drops, masks = redact_line(line, rs)
        if new is None:
            result.dropped.append((i, drops[0], line))
            continue
        for rule_id, matched in masks:
            result.masked.append((i, rule_id, matched))
        kept.append(new)
    result.text = "\n".join(kept)
    return result
