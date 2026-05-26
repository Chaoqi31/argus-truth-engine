"""Argus orchestrator — LangGraph pipeline.

Public API: ``audit_pdf``, ``audit_text``.
"""
# Re-exported for test-patch compatibility only — `tests/test_pipeline_dryrun.py`
# patches `argus.orchestrator.MiromindClient` / `CheapLLMClient`. Not part of
# the public API.
from argus.llm.cheap_client import CheapLLMClient  # noqa: F401
from argus.miromind.client import MiromindClient  # noqa: F401
from argus.orchestrator.entry import audit_pdf, audit_text  # noqa: F401
