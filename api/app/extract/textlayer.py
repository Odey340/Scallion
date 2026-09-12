"""Text layer of the uploaded file, in memory only. Spans in the response index into this string."""
import io

from pypdf import PdfReader

PDF_MIMES = {"application/pdf"}
IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_MIMES = PDF_MIMES | IMAGE_MIMES

PAGE_BREAK = "\n\f"


def sniff_mime(data: bytes, declared: str | None) -> str | None:
    if data.startswith(b"%PDF"):
        return "application/pdf"
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return declared if declared in ALLOWED_MIMES else None


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    pages = [(page.extract_text() or "") for page in reader.pages]
    return PAGE_BREAK.join(pages)


def text_layer(data: bytes, mime: str) -> str:
    if mime in PDF_MIMES:
        return pdf_text(data)
    return ""  # images have no text layer; spans come back null
