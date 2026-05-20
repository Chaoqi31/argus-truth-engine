"""End-to-end test for the Plan A orchestrator using a fully mocked MiroMind client."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

from argus.config import Settings
from argus.models.domain import ClaimType, FindingVerdict, StepType
from argus.models.miromind import (
    ResponseCompletedEvent,
    ResponseOutputItemDoneEvent,
    ResponseOutputTextDeltaEvent,
    ResponseSummary,
    Usage,
)
from argus.orchestrator import audit_pdf

FIXTURE_PDF = Path(__file__).parent / "fixtures" / "sample-report.pdf"


def _msg(text: str, seq: int = 1) -> ResponseOutputTextDeltaEvent:
    return ResponseOutputTextDeltaEvent(
        type="response.output_text.delta",
        sequence_number=seq,
        item_id="msg",
        output_index=0,
        content_index=0,
        delta=text,
    )


def _completed(seq: int = 99) -> ResponseCompletedEvent:
    return ResponseCompletedEvent(
        type="response.completed",
        sequence_number=seq,
        response=ResponseSummary(
            id="resp_x", status="completed", usage=Usage(total_tokens=10)
        ),
    )


def _tool_call(name: str, args: dict[str, Any], seq: int) -> ResponseOutputItemDoneEvent:
    return ResponseOutputItemDoneEvent(
        type="response.output_item.done",
        sequence_number=seq,
        output_index=1,
        item={
            "type": "tool_call",
            "id": f"tc_{seq}",
            "name": name,
            "arguments": json.dumps(args),
            "result": json.dumps({"ok": True}),
            "status": "completed",
        },
    )


def _events_seq(events: list[Any]) -> Any:
    async def gen() -> Any:
        for e in events:
            yield e

    return gen()


async def test_orchestrator_emits_findings_for_each_citation(tmp_path: Path) -> None:
    planner_json = json.dumps(
        {
            "claims": [
                {
                    "id": "c1",
                    "text": "Smith (2021) showed X.",
                    "page": 1,
                    "span": [0, 21],
                    "type": "citation",
                    "importance": "high",
                    "extracted_metadata": {"authors": ["Smith"], "year": 2021},
                },
                {
                    "id": "c2",
                    "text": "Doe et al. (2019) studied Y.",
                    "page": 1,
                    "span": [22, 50],
                    "type": "citation",
                    "importance": "medium",
                    "extracted_metadata": {"authors": ["Doe"], "year": 2019},
                },
            ]
        }
    )

    verifier_json_1 = json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.9,
            "summary": "No DOI found.",
            "evidence": [
                {
                    "source_type": "crossref",
                    "url": "https://api.crossref.org/works?query=Smith",
                    "snippet": "{}",
                }
            ],
        }
    )
    verifier_json_2 = json.dumps(
        {
            "verdict": "ok",
            "confidence": 0.85,
            "summary": "Found in Crossref.",
            "evidence": [
                {
                    "source_type": "crossref",
                    "url": "https://doi.org/10.1234/x",
                    "snippet": "{}",
                }
            ],
        }
    )
    # Alignment uses verdict "uncertain" for both citations to keep it simple.
    alignment_json = json.dumps(
        {
            "verdict": "uncertain",
            "confidence": 0.4,
            "summary": "Source not retrievable.",
            "evidence": [
                {"source_type": "web_page", "url": None, "snippet": "404"}
            ],
        }
    )
    # Consistency runs over the full claim list whenever >= 2 claims exist.
    # Return zero contradictions so this test focuses on citation-pair findings.
    consistency_json = json.dumps({"contradictions": []})
    # Reporter fires after specialists; ranked list empty keeps existing order.
    reporter_json = json.dumps(
        {
            "executive_summary_md": "Audit complete.",
            "ranked_finding_ids": [],
        }
    )

    streams = iter(
        [
            [_msg(planner_json), _completed()],
            [_tool_call("web_search", {"q": "Smith 2021"}, 2), _msg(verifier_json_1), _completed()],
            [_tool_call("web_search", {"q": "Smith pdf"}, 2), _msg(alignment_json), _completed()],
            [_tool_call("fetch_url_content", {"url": "x"}, 2), _msg(verifier_json_2), _completed()],
            [_tool_call("fetch_url_content", {"url": "y"}, 2), _msg(alignment_json), _completed()],
            [_msg(consistency_json), _completed()],
            [_msg(reporter_json), _completed()],
        ]
    )
    rids = iter(
        [
            "resp_planner",
            "resp_v1",
            "resp_a1",
            "resp_v2",
            "resp_a2",
            "resp_cons",
            "resp_report",
        ]
    )

    client = AsyncMock()
    client.submit_background = AsyncMock(side_effect=lambda **kw: next(rids))
    client.stream = lambda rid, after=0: _events_seq(next(streams))

    out = tmp_path / "findings.json"
    job = await audit_pdf(
        pdf_path=FIXTURE_PDF,
        output_path=out,
        settings=Settings(miromind_api_key="x"),
        client=client,  # type: ignore[arg-type]
    )

    assert len(job.claims) == 2  # noqa: PLR2004
    assert all(c.type == ClaimType.CITATION for c in job.claims)
    # Each citation now produces a Verifier finding AND an Alignment finding.
    assert len(job.findings) == 4  # noqa: PLR2004
    by_agent = {f.agent for f in job.findings}
    assert by_agent == {"CitationVerifier", "CitationAlignment"}
    # The two Verifier verdicts are still the original FABRICATED / OK pair.
    verifier_verdicts = sorted(
        f.verdict for f in job.findings if f.agent == "CitationVerifier"
    )
    assert verifier_verdicts == sorted([FindingVerdict.FABRICATED, FindingVerdict.OK])
    assert any(s.type == StepType.WEB_SEARCH for t in job.traces for s in t.steps)
    assert out.exists()
    saved = json.loads(out.read_text())
    assert saved["id"] == job.id
