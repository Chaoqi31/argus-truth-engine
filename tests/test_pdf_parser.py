"""Tests for the PDF parser."""
from __future__ import annotations

from pathlib import Path

import pytest

from argus.pdf.parser import ParsedDoc, parse_pdf

FIXTURE = Path(__file__).parent / "fixtures" / "sample-report.pdf"


def test_parse_pdf_returns_four_pages() -> None:
    doc = parse_pdf(FIXTURE)
    assert isinstance(doc, ParsedDoc)
    assert len(doc.pages) == 4


def test_parsed_text_contains_known_citations() -> None:
    doc = parse_pdf(FIXTURE)
    full = "\n".join(p.text for p in doc.pages)
    assert "Smith (2021)" in full
    assert "Doe et al., 2019" in full


def test_page_map_is_monotonic() -> None:
    doc = parse_pdf(FIXTURE)
    offsets = [p.start_offset for p in doc.pages]
    assert offsets == sorted(offsets)


def test_parse_pdf_raises_on_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        parse_pdf(tmp_path / "nope.pdf")
