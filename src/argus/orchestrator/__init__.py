"""Argus orchestrator — LangGraph pipeline.

Public API: ``audit_pdf``, ``audit_text``. During refactor we re-export from
``_legacy`` so callers don't break. Subsequent tasks migrate names into
focused modules and remove ``_legacy``.
"""
from argus.orchestrator._legacy import audit_pdf, audit_text  # noqa: F401
from argus.orchestrator._legacy import CheapLLMClient, MiromindClient  # noqa: F401
