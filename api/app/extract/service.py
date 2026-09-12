"""bytes -> text layer -> model -> canonical names -> spans -> units normalised -> ExtractResponse. Nothing touches disk."""
from .canonical import canonical_keys, canonicalize
from .gemini import Extractor
from .complete import complete_your_clock
from .normalize import normalize
from .schema import Analyte, ExtractResponse
from .spans import find_span
from .textlayer import text_layer


def run_extract(data: bytes, mime: str, extractor: Extractor) -> ExtractResponse:
    text = text_layer(data, mime)
    raw = extractor.extract(data, mime, text)

    analytes: list[Analyte] = []
    seen: set[str] = set()
    for a in raw.analytes:
        name = canonicalize(a.raw_name)
        if name in seen and not name.startswith("other:"):
            name = f"other:{a.raw_name.strip()}"  # a second glucose row is not the glucose
        seen.add(name)
        analytes.append(
            Analyte(
                name=name,
                value=a.value,
                unit=a.unit,
                ref_low=a.ref_low,
                ref_high=a.ref_high,
                source_span=find_span(text, a.source_text),
                source_text=a.source_text,
                raw_name=a.raw_name,
            )
        )

    missing = [k for k in canonical_keys() if k not in seen]
    resp = normalize(ExtractResponse(analytes=analytes, fasting=raw.fasting, lang=raw.lang, text=text, missing=missing))
    return resp.model_copy(update={"complete": complete_your_clock(resp)})
