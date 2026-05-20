"""5-agent orchestrator end-to-end test with a fully mocked MiroMind client."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

from argus.config import Settings
from argus.models.domain import (
    FindingVerdict,
    Severity,
    StepType,
)
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


def _completed(seq: int = 99, tokens: int = 100) -> ResponseCompletedEvent:
    return ResponseCompletedEvent(
        type="response.completed",
        sequence_number=seq,
        response=ResponseSummary(
            id="resp_x", status="completed", usage=Usage(total_tokens=tokens)
        ),
    )


def _tool(name: str, args: dict[str, Any], seq: int) -> ResponseOutputItemDoneEvent:
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


async def test_full_5_agent_pipeline(tmp_path: Path) -> None:
    planner_json = json.dumps(
        {
            "claims": [
                {
                    "id": "c1",
                    "text": "Smith (2021) showed X.",
                    "page": 1,
                    "span": [0, 22],
                    "type": "citation",
                    "importance": "high",
                    "extracted_metadata": {"authors": ["Smith"], "year": 2021},
                },
                {
                    "id": "c2",
                    "text": "US Q2 2025 GDP growth was 2.1%.",
                    "page": 2,
                    "span": [0, 32],
                    "type": "numerical-data",
                    "importance": "high",
                    "extracted_metadata": {"indicator": "GDP growth", "value": 2.1},
                },
                {
                    "id": "c3",
                    "text": "Margin is 32%.",
                    "page": 3,
                    "span": [0, 14],
                    "type": "numerical-data",
                    "importance": "high",
                    "extracted_metadata": {"indicator": "margin", "value": 32.0},
                },
            ]
        }
    )

    verifier_json = json.dumps(
        {
            "verdict": "fabricated",
            "confidence": 0.92,
            "summary": "No record.",
            "evidence": [
                {"source_type": "crossref", "url": "https://api.crossref.org/x", "snippet": "{}"}
            ],
        }
    )
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
    freshness_json_c2 = json.dumps(
        {
            "verdict": "stale",
            "confidence": 0.9,
            "summary": "Q3 2025 GDP growth is 2.4%, newer release available.",
            "as_of_date": "Q2 2025",
            "current_value": "2.4%",
            "evidence": [
                {"source_type": "fred", "url": "https://api.stlouisfed.org/", "snippet": "2.4"}
            ],
        }
    )
    freshness_json_c3 = json.dumps(
        {
            "verdict": "ok",
            "confidence": 0.7,
            "summary": "Most recent reported margin matches.",
            "as_of_date": None,
            "current_value": "32%",
            "evidence": [
                {
                    "source_type": "sec_edgar",
                    "url": "https://data.sec.gov/x",
                    "snippet": "",
                }
            ],
        }
    )
    consistency_json = json.dumps(
        {
            "contradictions": [
                {
                    "claim_a_id": "c2",
                    "claim_b_id": "c3",
                    "severity": "minor",
                    "confidence": 0.55,
                    "summary": (
                        "GDP growth and margin are unrelated metrics; "
                        "flagged as low-severity tension only."
                    ),
                }
            ]
        }
    )
    reporter_summary = (
        "**3 issues** detected.\n\n"
        "- 1 fabricated citation (major).\n"
        "- Q2 GDP figure is stale.\n"
        "- A minor numerical tension between metrics."
    )
    reporter_json = json.dumps(
        {
            "executive_summary_md": reporter_summary,
            "ranked_finding_ids": [],
        }
    )

    streams = iter(
        [
            # planner
            [_msg(planner_json), _completed(tokens=120)],
            # verifier c1
            [
                _tool("web_search", {"q": "Smith"}, 2),
                _msg(verifier_json),
                _completed(tokens=80),
            ],
            # alignment c1
            [
                _tool("fetch_url_content", {"url": "x"}, 2),
                _msg(alignment_json),
                _completed(tokens=70),
            ],
            # freshness c2
            [
                _tool("fetch_url_content", {"url": "fred"}, 2),
                _msg(freshness_json_c2),
                _completed(tokens=90),
            ],
            # freshness c3
            [
                _tool("fetch_url_content", {"url": "sec"}, 2),
                _msg(freshness_json_c3),
                _completed(tokens=60),
            ],
            # consistency batch
            [
                _tool("execute_python", {"code": "..."}, 2),
                _msg(consistency_json),
                _completed(tokens=110),
            ],
            # reporter
            [_msg(reporter_json), _completed(tokens=40)],
        ]
    )
    rids = iter(
        [
            "resp_planner",
            "resp_verif_c1",
            "resp_align_c1",
            "resp_fresh_c2",
            "resp_fresh_c3",
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

    assert len(job.claims) == 3  # noqa: PLR2004
    # 1 verifier finding (c1) + 1 alignment finding (c1) + 2 freshness findings (c2, c3) +
    # 2 paired-contradiction findings (c2, c3) = 6 total
    assert len(job.findings) == 6  # noqa: PLR2004
    by_agent = {f.agent for f in job.findings}
    assert by_agent == {
        "CitationVerifier",
        "CitationAlignment",
        "DataFreshness",
        "Consistency",
    }

    # Reporter populated audit_report_md
    assert job.audit_report_md is not None
    assert "3 issues" in job.audit_report_md

    # Contradiction findings cross-link each other
    consistency_findings = [f for f in job.findings if f.agent == "Consistency"]
    assert len(consistency_findings) == 2  # noqa: PLR2004
    f_a, f_b = consistency_findings
    assert f_a.id in f_b.related_finding_ids
    assert f_b.id in f_a.related_finding_ids
    # Severity is propagated from the parsed pair.
    assert f_a.severity == Severity.MINOR
    assert f_b.severity == Severity.MINOR

    # At least one trace step records the web_search the Verifier used.
    step_types = {s.type for t in job.traces for s in t.steps}
    assert StepType.WEB_SEARCH in step_types
    assert StepType.FETCH_URL_CONTENT in step_types

    # FABRICATED verdict came through on the Verifier finding.
    verifier_findings = [f for f in job.findings if f.agent == "CitationVerifier"]
    assert len(verifier_findings) == 1
    assert verifier_findings[0].verdict == FindingVerdict.FABRICATED

    # File is written and round-trips.
    saved = json.loads(out.read_text())
    assert saved["id"] == job.id
    assert saved["audit_report_md"] is not None
