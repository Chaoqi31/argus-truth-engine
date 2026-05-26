"""Argus orchestrator — LangGraph pipeline.

Public API: ``audit_pdf``, ``audit_text``. During refactor we re-export from
``_legacy`` so callers don't break. Subsequent tasks migrate names into
focused modules and remove ``_legacy``.
"""
from argus.orchestrator._legacy import audit_pdf, audit_text  # noqa: F401

# Re-exported for test-patch compatibility only — `tests/test_pipeline_dryrun.py`
# patches `argus.orchestrator.MiromindClient` / `CheapLLMClient`. Not part of
# the public API. Remove once those tests are updated (or once `_legacy` is
# deleted in Task 1.7).
from argus.orchestrator._legacy import CheapLLMClient, MiromindClient  # noqa: F401
