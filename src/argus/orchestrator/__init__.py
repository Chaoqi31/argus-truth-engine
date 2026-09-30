"""Argus orchestrator: the audit pipeline.

Public API: ``audit_pdf``, ``audit_text``.
"""
from argus.orchestrator.entry import audit_pdf as audit_pdf
from argus.orchestrator.entry import audit_text as audit_text

__all__ = ["audit_pdf", "audit_text"]
