"""Locate a printed line inside the text layer. Whitespace-insensitive, tolerant of
trailing zeros in numbers (0.8 matches 0.80), returns [start, end)."""
import re

_NUM = re.compile(r"^([<>]?)(\d+)(?:\.(\d+))?$")


def _tokens(s: str) -> list[str]:
    return [t for t in re.split(r"\s+", s.strip()) if t]


def _token_pattern(tok: str) -> str:
    m = _NUM.match(tok)
    if not m:
        parts = tok.split("-")
        if len(parts) == 2 and all(_NUM.match(x) for x in parts):  # a range like 0.0-3.0
            return _token_pattern(parts[0]) + r"\s*-\s*" + _token_pattern(parts[1])
        return re.escape(tok)
    sign, whole, frac = m.groups()
    frac = (frac or "").rstrip("0")
    core = re.escape(whole) + (r"\." + re.escape(frac) + r"0*" if frac else r"(?:\.0+)?")
    return re.escape(sign) + core


def find_span(text: str, quote: str) -> tuple[int, int] | None:
    if not text or not quote:
        return None
    start = text.find(quote)
    if start >= 0:
        return (start, start + len(quote))
    toks = _tokens(quote)
    if not toks:
        return None
    m = re.search(r"\s*".join(_token_pattern(t) for t in toks), text)
    if m:
        return (m.start(), m.end())
    # Last resort: the analyte name followed by the first value-looking token on the same line(s).
    nums = [t for t in toks if _NUM.match(t)]
    if nums:
        name_end = toks.index(nums[0])
        name = r"\s*".join(re.escape(t) for t in toks[:name_end]) or re.escape(toks[0])
        m = re.search(name + r"[^\n]*?\n?[^\n]*?" + _token_pattern(nums[0]), text, flags=re.IGNORECASE)
        if m:
            return (m.start(), m.end())
    return None
