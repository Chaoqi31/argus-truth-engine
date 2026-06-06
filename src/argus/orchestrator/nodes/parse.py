"""Phase A node: parse PDF or raw text into a ParsedDoc."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from argus.log import log
from argus.orchestrator.assemblers import _text_to_doc
from argus.orchestrator.context import _Ctx, _State
from argus.pdf.parser import parse_pdf


def _parse_node(ctx: _Ctx) -> Callable[[_State], Awaitable[dict[str, Any]]]:
    async def node(state: _State) -> dict[str, Any]:
        await ctx.publisher.stage(
            status="started",
            key="parse",
            name="Parse",
            engine="deterministic",
        )
        text = state.get("text")
        if text:
            log.info("orchestrator.parse_text", chars=len(text), job_id=ctx.job_id)
            doc = _text_to_doc(text)
            summary = f"Read {len(doc.full_text)} chars of input text"
        else:
            pdf_path = state["pdf_path"]
            log.info("orchestrator.parse_start", pdf=str(pdf_path), job_id=ctx.job_id)
            doc = parse_pdf(pdf_path)
            summary = f"Parsed {len(doc.pages)} page(s) · {len(doc.full_text)} chars"
        log.info("orchestrator.parse_done", pages=len(doc.pages))
        await ctx.publisher.stage(
            status="finished",
            key="parse",
            name="Parse",
            engine="deterministic",
            summary=summary,
            metrics={"pages": len(doc.pages), "chars": len(doc.full_text)},
        )
        return {"doc": doc}
    return node
