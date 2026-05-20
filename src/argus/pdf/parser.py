"""PDF parsing for Argus.

Plan A uses only pdfplumber for text extraction (and pymupdf as a backup if
pdfplumber returns nothing). Multi-engine fallback + table extraction land
in Plan B.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber
import pymupdf


@dataclass(frozen=True)
class ParsedPage:
    page_number: int  # 1-based
    text: str
    start_offset: int  # offset in the concatenated full_text


@dataclass(frozen=True)
class ParsedDoc:
    source_path: Path
    pages: tuple[ParsedPage, ...]
    full_text: str = field(default="")

    def page_for_offset(self, char_offset: int) -> ParsedPage | None:
        for page in self.pages:
            if page.start_offset <= char_offset < page.start_offset + len(page.text):
                return page
        return None


def parse_pdf(path: Path | str) -> ParsedDoc:
    """Parse a PDF file into a ParsedDoc."""
    src = Path(path)
    if not src.exists():
        raise FileNotFoundError(src)

    pages: list[ParsedPage] = []
    full_chunks: list[str] = []
    cursor = 0

    with pdfplumber.open(src) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if not text.strip():
                text = _pymupdf_text(src, i - 1)
            pages.append(ParsedPage(page_number=i, text=text, start_offset=cursor))
            full_chunks.append(text)
            cursor += len(text) + 1  # +1 for the join "\n"

    return ParsedDoc(
        source_path=src,
        pages=tuple(pages),
        full_text="\n".join(full_chunks),
    )


def _pymupdf_text(src: Path, page_index: int) -> str:
    """Fallback text extraction via pymupdf for pages pdfplumber leaves empty."""
    doc = pymupdf.open(src)  # type: ignore[no-untyped-call]
    try:
        page = doc[page_index]
        text: str = page.get_text("text") or ""  # type: ignore[no-untyped-call]
        return text
    finally:
        doc.close()  # type: ignore[no-untyped-call]
