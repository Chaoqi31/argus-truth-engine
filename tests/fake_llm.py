"""Scripted stand-in for the two LLM providers Argus talks to over HTTP.

Serves the MiroMind Responses API (``POST /v1/responses`` plus the SSE stream
at ``GET /v1/responses/{id}``) and an OpenAI-compatible
``POST /chat/completions``. Every answer comes from the scenario tables below,
keyed by claim text, so the same audit always produces the same output no
matter how the pipeline schedules its calls.

Tests start it in-process (see ``tests/golden.py``). For a manual end-to-end
run against the real API server and web UI:

    uv run python -m tests.fake_llm --port 9911
    ARGUS_MIROMIND_BASE_URL=http://127.0.0.1:9911/v1 \\
    ARGUS_CHEAP_LLM_BASE_URL=http://127.0.0.1:9911 \\
    ARGUS_MIROMIND_API_KEY=fake ARGUS_CHEAP_LLM_API_KEY=fake uv run argus serve
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

# --- Scenario ---------------------------------------------------------------

S1 = "Acme Corp reported revenue of $12.4 billion in fiscal 2024, up 18% year over year."
S2 = "Smith and Lee (2021) showed that widget demand doubles every three years."
S3 = "Acme was founded in 1998 in Austin, Texas."
S4 = "Acme is widely regarded as an innovative company."
S5 = "Acme's operating margin was 32% in fiscal 2024."
S6 = "Acme's operating margin was 28% in fiscal 2024."
S7 = "Acme employs about 4,000 people."

AUDIT_TEXT = " ".join([S1, S2, S3, S4, S5, S6, S7])

A1 = "Acme Corp reported revenue of $12.4 billion in fiscal 2024."
A2 = "Acme Corp's revenue grew 18% year over year in fiscal 2024."

PDF_C1 = "It mentions Smith (2021) and (Doe et al., 2019)."
PDF_C2 = "Global widget shipments grew 4.2% YoY in 2024 (Source: WidgetWorld, 2025)."


def _text_claims() -> list[dict[str, Any]]:
    rows = [
        ("c1", S1, "numerical-data", "high"),
        ("c2", S2, "citation", "high"),
        ("c3", S3, "cross-reference", "medium"),
        ("c4", S4, "qualitative", "low"),
        ("c5", S5, "numerical-data", "high"),
        ("c6", S6, "numerical-data", "medium"),
        ("c7", S7, "numerical-data", "low"),
    ]
    out = []
    for cid, text, ctype, importance in rows:
        start = AUDIT_TEXT.index(text)
        out.append(
            {
                "id": cid,
                "text": text,
                "page": 1,
                "span": [start, start + len(text)],
                "type": ctype,
                "importance": importance,
                "extracted_metadata": {"authors": ["Smith", "Lee"], "year": 2021}
                if cid == "c2"
                else {},
            }
        )
    return out


PDF_CLAIMS: list[dict[str, Any]] = [
    {
        "id": "c1",
        "text": PDF_C1,
        "page": 1,
        "span": [74, 122],
        "type": "citation",
        "importance": "high",
        "extracted_metadata": {"authors": ["Smith"], "year": 2021},
    },
    {
        "id": "c2",
        "text": PDF_C2,
        "page": 2,
        "span": [25, 99],
        "type": "numerical-data",
        "importance": "medium",
        "extracted_metadata": {},
    },
]

# Parent claim text -> atoms (text, type). S5 deliberately yields a duplicate
# atom so the review gate's dedupe has work to do.
ATOMS: dict[str, list[tuple[str, str]]] = {
    S1: [(A1, "numerical-data"), (A2, "numerical-data")],
    S2: [(S2, "citation")],
    S3: [(S3, "cross-reference")],
    S4: [(S4, "qualitative")],
    S5: [
        (S5, "numerical-data"),
        ("acme's operating margin was 32% in fiscal 2024", "numerical-data"),
    ],
    S6: [(S6, "numerical-data")],
    S7: [(S7, "numerical-data")],
}

NOT_CHECKWORTHY: dict[str, str] = {S4: "Subjective reputation claim"}


def _evidence(*urls: str) -> list[dict[str, Any]]:
    return [
        {"source_type": "web_page", "url": url, "snippet": f"Excerpt from {url}"} for url in urls
    ]


def _verdict(
    verdict: str,
    confidence: float,
    summary: str,
    urls: tuple[str, ...],
    *,
    why_wrong: str | None = None,
    correct: dict[str, Any] | None = None,
    computation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "verdict": verdict,
        "confidence": confidence,
        "summary": summary,
        "why_wrong": why_wrong,
        "correct_information": correct,
        "evidence": _evidence(*urls),
        "evidence_quality": [
            {
                "evidence_index": i,
                "authority": 0.9,
                "independence": 0.8,
                "freshness": 0.7,
                "directness": 0.9,
                "role": "primary_source" if i == 0 else "secondary_source",
                "rationale": f"Source {i + 1} addresses the claim directly.",
            }
            for i in range(len(urls))
        ],
        "coverage": [
            {
                "claim_fragment": summary.split(".", maxsplit=1)[0],
                "relation": "supports" if verdict == "ok" else "refutes",
                "evidence_indices": list(range(len(urls))),
                "reason": "The cited sources address this fragment.",
            }
        ],
        "computation_check": computation,
        "reasoning_chain": [
            {
                "action": "Searched primary sources for the claim",
                "observation": f"Found {len(urls)} relevant source(s)",
                "reasoning": "Compared the claim with what the sources state.",
            },
            {
                "action": "Cross-checked the figures",
                "observation": summary,
                "reasoning": f"Verdict: {verdict}.",
            },
        ],
    }


# Claim text -> verifier JSON. ``None`` means the verifier answers in prose
# that no parser can recover, on both the first call and the repair call.
VERIFIER: dict[str, dict[str, Any] | None] = {
    A1: _verdict(
        "ok",
        0.9,
        "Revenue of $12.4 billion matches the FY2024 annual report.",
        ("https://www.sec.gov/acme-10k-2024", "https://www.reuters.com/acme-results"),
        computation={
            "kind": "numeric",
            "claimed_value": "$12.4 billion",
            "extracted_values": [
                {
                    "label": "FY2024 revenue",
                    "value": "12.4",
                    "unit": "USD bn",
                    "source_evidence_index": 0,
                },
            ],
            "formula": "reported == claimed",
            "computed_value": "12.4",
            "tolerance": "rounding to 0.1",
            "judgment": "matches",
            "rationale": "The filing reports the same figure.",
        },
    ),
    A2: _verdict(
        "inaccurate",
        0.88,
        "Revenue grew 12%, not 18%.",
        (
            "https://www.sec.gov/acme-10k-2024",
            "https://www.reuters.com/acme-results",
            "https://www.bloomberg.com/acme",
        ),
        why_wrong="The claim overstates growth by six points.",
        correct={
            "value": "12% year over year",
            "source": "Acme FY2024 10-K",
            "url": "https://www.sec.gov/acme-10k-2024",
            "retrieved_date": "2026-09-01",
        },
    ),
    S2: _verdict(
        "fabricated",
        0.7,
        "No paper by Smith and Lee (2021) on widget demand exists.",
        (
            "https://api.crossref.org/works?query=smith+lee+widget",
            "https://scholar.google.com/scholar?q=smith+lee+2021+widget",
        ),
        why_wrong="The cited study cannot be found in any index.",
    ),
    S3: _verdict(
        "ok",
        0.95,
        "Acme's founding in 1998 in Austin is documented.",
        ("https://en.wikipedia.org/wiki/Acme_Corp",),
    ),
    S5: _verdict(
        "inaccurate",
        0.92,
        "The operating margin was 30%, not 32%.",
        ("https://www.sec.gov/acme-10k-2024", "https://www.ft.com/acme-margins"),
        why_wrong="The margin is overstated by two points.",
        correct={
            "value": "30%",
            "source": "Acme FY2024 10-K",
            "url": "https://www.sec.gov/acme-10k-2024",
            "retrieved_date": "2026-09-01",
        },
    ),
    S6: None,
    S1: _verdict(
        "inaccurate",
        0.8,
        "Revenue matches but growth was 12%, not 18%.",
        ("https://www.sec.gov/acme-10k-2024", "https://www.reuters.com/acme-results"),
        why_wrong="The growth figure is overstated.",
        correct={
            "value": "12% year over year",
            "source": "Acme FY2024 10-K",
            "url": None,
            "retrieved_date": None,
        },
    ),
    S7: _verdict(
        "ok",
        0.9,
        "Headcount of about 4,000 matches the annual report.",
        ("https://www.sec.gov/acme-10k-2024", "https://www.linkedin.com/company/acme"),
    ),
    PDF_C1: _verdict(
        "fabricated",
        0.75,
        "Neither Smith (2021) nor Doe et al. (2019) could be located.",
        (
            "https://api.crossref.org/works?query=smith+2021+widget",
            "https://papers.ssrn.com/sol3/results.cfm?q=doe+2019",
        ),
        why_wrong="Both citations appear invented.",
    ),
    PDF_C2: _verdict(
        "outdated",
        0.86,
        "WidgetWorld revised 2024 shipment growth to 3.1%.",
        ("https://www.widgetworld.example/2025-report", "https://www.imf.org/widgets"),
        why_wrong="A newer revision supersedes the 4.2% figure.",
        correct={
            "value": "3.1% YoY",
            "source": "WidgetWorld 2025 revision",
            "url": "https://www.widgetworld.example/2025-report",
            "retrieved_date": "2026-09-01",
        },
    ),
}

# Claim text -> skeptic JSON for the verdicts the skeptic challenges.
SKEPTIC: dict[str, dict[str, Any]] = {
    S2: {
        "status": "counterevidence_found",
        "summary": "A 2021 working paper by Smith & Lee on widget cycles exists on SSRN.",
        "recommended_verdict": "uncertain",
        "counterevidence": [
            {
                "source": "SSRN",
                "url": "https://papers.ssrn.com/smith-lee-2021",
                "snippet": "Smith, Lee (2021). Widget demand cycles.",
                "relevance": "A matching working paper may be what the claim cites.",
            }
        ],
    },
    S1: {
        "status": "no_counterevidence",
        "summary": "No source supports 18% growth.",
        "recommended_verdict": None,
        "counterevidence": [],
    },
    PDF_C1: {
        "status": "inconclusive",
        "summary": "Could not rule out a regional journal.",
        "recommended_verdict": None,
        "counterevidence": [],
    },
}

CONTRADICTIONS: list[tuple[str, str, str, float, str]] = [
    (S5, S6, "critical", 0.9, "The report states two different FY2024 operating margins."),
]

FLAWS: list[tuple[str, str, str, float, str, str]] = [
    (
        A1,
        "unsupported_inference",
        "minor",
        0.6,
        "The revenue figure is presented without its reporting basis.",
        "The accounting basis (GAAP or adjusted) for the revenue figure.",
    ),
    (
        A2,
        "overreach",
        "major",
        0.7,
        "Growth is presented as a trend from a single year.",
        "Multi-year growth data.",
    ),
    (
        S1,
        "overreach",
        "major",
        0.7,
        "Growth is presented as a trend from a single year.",
        "Multi-year growth data.",
    ),
]

REPORT_MD = (
    "**Two figures are wrong.** Revenue growth was 12%, not 18%, and the operating "
    "margin was 30%. The Smith and Lee citation could not be confirmed. The FY2024 "
    "revenue figure checks out."
)

USAGE = {
    "input_tokens": 1000,
    "output_tokens": 500,
    "total_tokens": 1500,
    "reasoning_tokens": 200,
    "num_search_queries": 0,
}
VERIFIER_USAGE = {**USAGE, "num_search_queries": 2}


# --- Task detection and answers --------------------------------------------

_CLAIMS_JSON = re.compile(r"CLAIMS:\n(\[.*\])", re.DOTALL)


def _claims_in(text: str) -> list[dict[str, Any]]:
    match = _CLAIMS_JSON.search(text)
    return json.loads(match.group(1)) if match else []


def _ids_by_text(text: str) -> dict[str, str]:
    return {c["text"]: c["id"] for c in _claims_in(text)}


def _claim_line(text: str) -> str:
    match = re.search(r"CLAIM:\s*\n?(.+)", text)
    if match is None:
        raise ValueError("request carries no CLAIM line")
    return match.group(1).strip()


def _task(prompt: str) -> str:
    for marker, task in (
        ("PLANNER agent", "planner"),
        ("claim decomposition specialist", "atomizer"),
        ("checkworthiness classifier", "checkworthiness"),
        ("CONSISTENCY CHECKER", "consistency"),
        ("You are Argus's REPORTER", "reporter"),
        ("UNIFIED VERIFIER", "verifier"),
        ("SKEPTIC REVIEWER", "skeptic"),
    ):
        if marker in prompt:
            return task
    raise ValueError("unrecognised prompt")


def answer(task: str, prompt: str) -> str:
    """The model's final text for one request."""
    if task == "planner":
        claims = PDF_CLAIMS if "[PAGE 1]" in prompt else _text_claims()
        return json.dumps({"claims": claims})
    if task == "atomizer":
        atoms = [
            {"parent_claim_id": c["id"], "text": atom, "type": atom_type}
            for c in _claims_in(prompt)
            for atom, atom_type in ATOMS.get(c["text"], [(c["text"], c["type"])])
        ]
        return json.dumps({"atoms": atoms})
    if task == "checkworthiness":
        results = [
            {
                "claim_id": c["id"],
                "checkworthy": c["text"] not in NOT_CHECKWORTHY,
                "reason": NOT_CHECKWORTHY.get(c["text"], "Specific and verifiable"),
            }
            for c in _claims_in(prompt)
        ]
        return json.dumps({"results": results})
    if task == "consistency":
        ids = _ids_by_text(prompt)
        return json.dumps(
            {
                "contradictions": [
                    {
                        "claim_a_id": ids[a],
                        "claim_b_id": ids[b],
                        "severity": sev,
                        "confidence": conf,
                        "summary": summary,
                    }
                    for a, b, sev, conf, summary in CONTRADICTIONS
                    if a in ids and b in ids
                ],
                "logical_flaws": [
                    {
                        "claim_id": ids[t],
                        "type": kind,
                        "severity": sev,
                        "confidence": conf,
                        "summary": summary,
                        "missing": missing,
                    }
                    for t, kind, sev, conf, summary, missing in FLAWS
                    if t in ids
                ],
            }
        )
    if task == "reporter":
        return json.dumps({"executive_summary_md": REPORT_MD})
    claim = _claim_line(prompt)
    if task == "verifier":
        scripted = VERIFIER.get(
            claim,
            _verdict(
                "ok",
                0.9,
                "The claim matches the sources.",
                ("https://www.reuters.com/default", "https://apnews.com/default"),
            ),
        )
        return (
            "Sorry, I could not finish the research." if scripted is None else json.dumps(scripted)
        )
    return json.dumps(
        SKEPTIC.get(
            claim,
            {
                "status": "no_counterevidence",
                "summary": "Nothing contradicts the verdict.",
                "recommended_verdict": None,
                "counterevidence": [],
            },
        )
    )


# --- MiroMind Responses stream ---------------------------------------------


def _sse_events(response_id: str, task: str, prompt: str) -> list[dict[str, Any]]:
    text = answer(task, prompt)
    events: list[dict[str, Any]] = [
        {"type": "response.created", "response": {"id": response_id, "status": "in_progress"}},
    ]
    if task in {"verifier", "skeptic"}:
        claim = _claim_line(prompt)
        call = {
            "type": "tool_call",
            "id": f"{response_id}_search",
            "name": "google_search",
            "arguments": json.dumps({"q": claim[:60]}),
        }
        events += [
            {
                "type": "response.reasoning_text.delta",
                "item_id": "r1",
                "output_index": 0,
                "content_index": 0,
                "delta": f"Plan: search for '{claim[:40]}'.",
            },
            {
                "type": "response.output_item.done",
                "output_index": 0,
                "item": {"type": "reasoning", "id": "r1"},
            },
            {
                "type": "response.output_item.added",
                "output_index": 1,
                "item": {**call, "status": "in_progress"},
            },
            {
                "type": "response.output_item.done",
                "output_index": 1,
                "item": {
                    **call,
                    "status": "completed",
                    "result": json.dumps({"organic": [{"link": "https://example.org"}]}),
                },
            },
        ]
    half = len(text) // 2
    for chunk in (text[:half], text[half:]):
        events.append(
            {
                "type": "response.output_text.delta",
                "item_id": "m1",
                "output_index": 2,
                "content_index": 0,
                "delta": chunk,
            }
        )
    usage = VERIFIER_USAGE if task == "verifier" else USAGE
    events.append(
        {
            "type": "response.completed",
            "response": {"id": response_id, "status": "completed", "usage": usage},
        }
    )
    return [{**ev, "sequence_number": seq} for seq, ev in enumerate(events, start=1)]


@dataclass
class FakeLLM:
    responses: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    requests: list[dict[str, Any]] = field(default_factory=list)

    def app(self) -> FastAPI:
        app = FastAPI()

        @app.post("/v1/responses")
        async def create_response(request: Request) -> JSONResponse:
            body = await request.json()
            prompt = body["input"]
            task = _task(prompt)
            digest = hashlib.sha1(prompt.encode(), usedforsecurity=False).hexdigest()[:10]
            response_id = f"resp_{task}_{digest}"
            self.responses[response_id] = _sse_events(response_id, task, prompt)
            self.requests.append(
                {"api": "responses", "task": task, "agent": body.get("metadata", {}).get("agent")}
            )
            return JSONResponse({"id": response_id, "status": "in_progress"})

        @app.get("/v1/responses/{response_id}")
        async def stream_response(response_id: str, after: int = 0) -> StreamingResponse:
            events = self.responses[response_id]

            def body() -> Iterator[bytes]:
                for ev in events:
                    if ev["sequence_number"] > after:
                        yield f"data: {json.dumps(ev)}\n\n".encode()

            return StreamingResponse(body(), media_type="text/event-stream")

        @app.post("/v1/responses/{response_id}/cancel")
        async def cancel(response_id: str) -> JSONResponse:
            return JSONResponse({"id": response_id, "status": "cancelled"})

        @app.post("/chat/completions")
        async def chat(request: Request) -> JSONResponse:
            body = await request.json()
            system, user = body["messages"][0]["content"], body["messages"][1]["content"]
            task = _task(system)
            self.requests.append({"api": "chat", "task": task, "agent": None})
            return JSONResponse({"choices": [{"message": {"content": answer(task, user)}}]})

        return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=9911)
    args = parser.parse_args()
    uvicorn.run(FakeLLM().app(), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
