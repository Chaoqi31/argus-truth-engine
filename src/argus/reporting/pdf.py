"""Render a completed Job into a styled PDF audit report."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import markdown as md
from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import CSS, HTML

from argus.models.domain import Finding, Job, ReasoningTrace, Step

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_ENV = Environment(
    loader=FileSystemLoader(_TEMPLATE_DIR),
    autoescape=select_autoescape(["html", "j2"]),
)

_SEVERITY_RANK = {"critical": 0, "major": 1, "minor": 2}


def _rank_findings(findings: list[Finding]) -> list[Finding]:
    """Sort by severity (critical first) then confidence (highest first)."""
    return sorted(
        findings,
        key=lambda f: (_SEVERITY_RANK.get(f.severity.value, 99), -f.confidence),
    )


def render_job_pdf(job: Job) -> bytes:
    """Render `job` to PDF bytes. Pure: no I/O beyond reading the templates."""
    findings_ranked = _rank_findings(job.findings)

    evidence_by_id = {e.id: e for e in job.evidences}
    evidence_by_finding: dict[str, list] = {
        f.id: [evidence_by_id[eid] for eid in f.evidence_ids if eid in evidence_by_id]
        for f in job.findings
    }

    trace_by_claim: dict[str, ReasoningTrace] = {t.claim_id: t for t in job.traces}
    steps_by_finding: dict[str, list[Step]] = {}
    for f in job.findings:
        trace = trace_by_claim.get(f.claim_id)
        steps_by_finding[f.id] = trace.steps if trace else []

    exec_md = job.audit_report_md or "_No executive summary available._"
    exec_html = md.markdown(exec_md, extensions=["extra"])

    template = _ENV.get_template("audit_report.html.j2")
    html_str = template.render(
        job=job,
        findings_ranked=findings_ranked,
        evidence_by_finding=evidence_by_finding,
        steps_by_finding=steps_by_finding,
        executive_summary_html=exec_html,
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )
    css = CSS(filename=str(_TEMPLATE_DIR / "audit_report.css"))
    return HTML(string=html_str).write_pdf(stylesheets=[css])
