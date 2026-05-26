"""Argus orchestrator — LangGraph pipeline.

Public API: ``audit_pdf``, ``audit_text``.
"""
# Re-exported for test-patch compatibility only — `tests/test_pipeline_dryrun.py`
# patches `argus.orchestrator.MiromindClient` / `CheapLLMClient`. Not part of
# the public API.
from argus.llm.cheap_client import CheapLLMClient as CheapLLMClient
from argus.miromind.client import MiromindClient as MiromindClient
from argus.orchestrator.entry import audit_pdf as audit_pdf
from argus.orchestrator.entry import audit_text as audit_text

__all__ = ["CheapLLMClient", "MiromindClient", "audit_pdf", "audit_text"]
