"""Resume a job from the interrupt point after a simulated restart.

Strategy (TODO): run Phase A → graph pauses at review_gate → close checkpointer →
rebuild from scratch (simulates fresh process) → resume with Command(resume=[ids]) →
verify Phase B completes with selected subset.

Currently xfails because it needs stub LLM clients (no test fixtures exist yet
for MiromindClient + CheapLLMClient). Tracked as follow-up.
"""
import pytest

from argus.config import Settings


@pytest.mark.asyncio
async def test_phase_a_pauses_at_review_then_resumes(tmp_path):
    """Use sqlite checkpointer file on disk to verify cross-process semantics."""
    db_path = tmp_path / "argus.db"
    _settings = Settings(
        db_url=f"sqlite+aiosqlite:///{db_path}",
        cheap_llm_api_key="",  # disabled
        miromind_api_key="fake",
        cache_enabled=False,
    )
    pytest.xfail(reason="needs stub MiromindClient + CheapLLMClient — tracked as follow-up")
