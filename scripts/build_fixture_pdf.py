"""Build the test fixture PDF used by tests. Run once via uv."""
from __future__ import annotations

from pathlib import Path

import pymupdf  # type: ignore[import-untyped]

PAGES = [
    "Argus Test Fixture — Page 1\n\n"
    "This sample report is for unit-test use only.\n"
    "It mentions Smith (2021) and (Doe et al., 2019).",
    "Page 2 — Market overview\n\n"
    "Global widget shipments grew 4.2% YoY in 2024 (Source: WidgetWorld, 2025).",
    "Page 3 — Citations\n\n"
    "1. Smith, J. (2021). On widget resilience. Journal of Widgets, 12(3), 45–60.\n"
    "2. Doe, A. et al. (2019). Widget supply chains. SSRN 1234567.",
    "Page 4 — Conclusion\n\n"
    "Widgets remain critical to global commerce.",
]


def build(out: Path) -> None:
    doc = pymupdf.open()
    for text in PAGES:
        page = doc.new_page(width=595, height=842)  # A4
        page.insert_text((50, 80), text, fontsize=12)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out)
    doc.close()


if __name__ == "__main__":
    build(Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "sample-report.pdf")
    print("wrote tests/fixtures/sample-report.pdf")
