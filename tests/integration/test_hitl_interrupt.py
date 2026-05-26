"""HITL interrupt round-trip: graph pauses at review_gate, resumes via Command.

LangGraph 1.0.6 notes:
- interrupt() surfaces as '__interrupt__' key in the ainvoke result dict.
- Command(resume=<value>) passes that value as the return of interrupt().
- Command(resume=None) triggers an UnboundLocalError in LG 1.0.6 — use
  Command(resume=[]) as the "no selection" sentinel instead.
"""
import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from typing_extensions import TypedDict


class _MiniState(TypedDict, total=False):
    claims: list[str]
    selected: list[str]


def _make_graph():
    def emit(state):
        return {"claims": ["c1", "c2", "c3"]}

    def gate(state):
        ids = interrupt({"awaiting": "review"})
        # Empty list means "no selection" → pass all claims through
        if not ids:
            return {"selected": state["claims"]}
        return {"selected": ids}

    g = StateGraph(_MiniState)
    g.add_node("emit", emit)
    g.add_node("gate", gate)
    g.add_edge(START, "emit")
    g.add_edge("emit", "gate")
    g.add_edge("gate", END)
    return g.compile(checkpointer=MemorySaver())


@pytest.mark.asyncio
async def test_interrupt_pauses_and_resume_with_command_picks_subset():
    graph = _make_graph()
    config = {"configurable": {"thread_id": "test_job"}}

    # First invoke: hits the interrupt — graph pauses, state has __interrupt__
    result = await graph.ainvoke({"claims": []}, config)
    assert "__interrupt__" in result, (
        f"Expected graph to pause with __interrupt__, got keys: {list(result.keys())}"
    )
    assert "selected" not in result, (
        "Graph should not have produced 'selected' before resume"
    )

    # Resume with user's selection — interrupt() returns the resume value
    final = await graph.ainvoke(Command(resume=["c1", "c3"]), config)
    assert final["selected"] == ["c1", "c3"]


@pytest.mark.asyncio
async def test_interrupt_then_resume_without_input_uses_all():
    """Resuming with an empty list signals 'no selection' → gate passes all claims through.

    Note: Command(resume=None) triggers an UnboundLocalError in LangGraph 1.0.6,
    so we use Command(resume=[]) as the no-op sentinel. The gate node treats an
    empty list the same as None (falsy check) and falls back to state['claims'].
    """
    graph = _make_graph()
    config = {"configurable": {"thread_id": "test_job_2"}}

    result = await graph.ainvoke({"claims": []}, config)
    assert "__interrupt__" in result

    # Resume with empty list (no selection) → gate falls through to state['claims']
    final = await graph.ainvoke(Command(resume=[]), config)
    assert final["selected"] == ["c1", "c2", "c3"]
