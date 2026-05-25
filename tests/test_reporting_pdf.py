"""Render an audit report PDF from the bundled sample Job."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from argus.models.domain import Job
from argus.reporting.pdf import render_job_pdf

SAMPLE = Path(__file__).parent.parent / "web" / "public" / "sample-findings.json"
_MIN_PDF_BYTES = 5_000


def _sample_job() -> Job:
    return Job.model_validate(json.loads(SAMPLE.read_text()))


def test_renders_non_empty_pdf_bytes():
    pdf = render_job_pdf(_sample_job())
    assert pdf.startswith(b"%PDF"), "output must be a valid PDF"
    assert len(pdf) > _MIN_PDF_BYTES, "PDF should contain real content, not just a stub"


def test_pdf_contains_every_finding_summary():
    job = _sample_job()
    pdf = render_job_pdf(job)
    # Try plain substring first; if WeasyPrint compresses streams, fall back to
    # pdftotext (available on macOS via `brew install poppler` and on Linux via
    # poppler-utils).
    for finding in job.findings:
        snippet_text = finding.summary[:40]
        snippet_bytes = snippet_text.encode("utf-8", errors="ignore")
        snippet_latin1 = snippet_text.encode("latin-1", errors="ignore")
        if snippet_bytes in pdf or snippet_latin1 in pdf:
            continue
        # Fall back to pdftotext extraction.
        if shutil.which("pdftotext") is None:
            raise AssertionError(
                f"finding {finding.id!r} summary {snippet_text!r} not found in raw "
                "PDF bytes and pdftotext is not available to fall back on"
            )
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf)
            tmp_path = tmp.name
        out = subprocess.check_output(["pdftotext", tmp_path, "-"])
        text = out.decode("utf-8", errors="ignore")
        assert snippet_text in text, (
            f"finding {finding.id!r} summary missing from extracted PDF text"
        )


def _extract_pdf_text(pdf: bytes) -> str:
    if shutil.which("pdftotext") is None:
        raise RuntimeError("pdftotext is required to extract text from compressed PDFs")
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf)
        tmp_path = tmp.name
    return subprocess.check_output(["pdftotext", tmp_path, "-"]).decode("utf-8", errors="ignore")


def test_audit_report_markdown_appears_in_pdf():
    job = _sample_job()
    job.audit_report_md = "EXEC_MARKER_42 strong leading risk."
    pdf = render_job_pdf(job)
    text = _extract_pdf_text(pdf)
    assert "EXEC_MARKER_42" in text
