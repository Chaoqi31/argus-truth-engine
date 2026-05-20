"""Core domain models for Argus.

These models represent the data flowing through the pipeline: PDFs become Claims,
Claims become Findings (with attached ReasoningTraces), and the final output is
the union of all of those plus the per-Step events MiroMind streamed back.
"""
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# --- Enums ----------------------------------------------------------------------------


class ClaimType(StrEnum):
    CITATION = "citation"
    NUMERICAL_DATA = "numerical-data"
    TIME_SENSITIVE = "time-sensitive"
    CROSS_REFERENCE = "cross-reference"
    QUALITATIVE = "qualitative"


class Severity(StrEnum):
    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"


class FindingVerdict(StrEnum):
    OK = "ok"
    FABRICATED = "fabricated"
    PARTIAL_MATCH = "partial-match"
    MISMATCH = "mismatch"
    MISREPRESENTED = "misrepresented"
    STALE = "stale"
    SUPERSEDED = "superseded"
    CONTRADICTION = "contradiction"
    UNCERTAIN = "uncertain"


class EvidenceSource(StrEnum):
    CROSSREF = "crossref"
    ARXIV = "arxiv"
    SSRN = "ssrn"
    SEC_EDGAR = "sec_edgar"
    FRED = "fred"
    WORLD_BANK = "worldbank"
    IMF = "imf"
    WIKIPEDIA = "wikipedia"
    COMPANY_FILING = "company_filing"
    WEB_PAGE = "web_page"
    INTERNAL_DOC = "internal_doc"


class StepType(StrEnum):
    THINKING = "thinking"
    WEB_SEARCH = "web_search"
    FETCH_URL_CONTENT = "fetch_url_content"
    EXECUTE_PYTHON = "execute_python"
    EXECUTE_COMMAND = "execute_command"
    TOOL_CALL = "tool_call"
    MESSAGE = "message"


# --- Models ---------------------------------------------------------------------------


class _Base(BaseModel):
    model_config = ConfigDict(frozen=False, extra="forbid")


class Claim(_Base):
    id: str
    text: str
    page: int = Field(ge=1)
    span: tuple[int, int]
    type: ClaimType
    importance: Literal["high", "medium", "low"]
    extracted_metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_span(self) -> Claim:
        start, end = self.span
        if start < 0 or end < start:
            raise ValueError(f"invalid span {self.span!r}")
        return self


class Evidence(_Base):
    id: str
    source_type: EvidenceSource
    url: str | None = None
    citation: str
    snippet: str = ""
    full_content_ref: str | None = None
    retrieved_at: datetime = Field(default_factory=datetime.utcnow)
    retrieved_by_step_id: str


class Step(_Base):
    id: str
    trace_id: str
    sequence: int = Field(ge=0)
    type: StepType
    summary: str
    content: dict[str, Any] = Field(default_factory=dict)
    evidence_ids: list[str] = Field(default_factory=list)
    parent_step_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ReasoningTrace(_Base):
    id: str
    job_id: str
    claim_id: str
    agent: str
    miromind_response_id: str
    started_at: datetime
    completed_at: datetime | None = None
    total_tokens: int = 0
    reasoning_tokens: int = 0
    num_search_queries: int = 0
    final_verdict_step_id: str | None = None
    steps: list[Step] = Field(default_factory=list)


class Finding(_Base):
    id: str
    job_id: str
    claim_id: str
    agent: str
    verdict: FindingVerdict
    severity: Severity = Severity.MINOR
    confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    evidence_ids: list[str] = Field(default_factory=list)
    reasoning_trace_id: str
    related_finding_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Job(_Base):
    id: str
    pdf_path: str
    status: Literal[
        "queued", "parsing", "planning", "verifying", "reporting", "done", "failed"
    ] = "queued"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    cost_usd: float = 0.0
    total_tokens: int = 0

    claims: list[Claim] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    traces: list[ReasoningTrace] = Field(default_factory=list)
    evidences: list[Evidence] = Field(default_factory=list)
