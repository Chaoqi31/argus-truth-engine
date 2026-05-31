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
    INACCURATE = "inaccurate"
    OUTDATED = "outdated"
    UNCERTAIN = "uncertain"
    UNSUPPORTED_INFERENCE = "unsupported-inference"
    OVERREACH = "overreach"


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
    page: int = Field(default=1, ge=0)
    span: tuple[int, int]
    type: ClaimType
    importance: Literal["high", "medium", "low"]
    extracted_metadata: dict[str, Any] = Field(default_factory=dict)
    parent_claim_id: str | None = None

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


class ReasoningStep(_Base):
    """One step in a structured reasoning chain — makes verification transparent."""

    step: str  # e.g. "premise", "search", "evidence_found", "comparison", "inference"
    content: str  # human-readable description
    evidence_ref: str | None = None  # link to evidence ID or URL
    confidence_delta: float = 0.0  # how this step affected confidence (+/-)


class CorrectedInfo(_Base):
    """What the correct information actually is, with authoritative source."""

    value: str
    source: str
    url: str | None = None
    retrieved_date: str | None = None


class VerificationStep(_Base):
    """One step in a verification chain — action/observation/reasoning triple."""

    action: str
    observation: str
    reasoning: str


class ConfidenceBreakdown(_Base):
    """Decomposed confidence — explains WHY confidence is at a certain level."""

    source_agreement: float = Field(default=0.0, ge=0.0, le=1.0)  # do sources agree?
    source_authority: float = Field(default=0.0, ge=0.0, le=1.0)  # how authoritative?
    evidence_freshness: float = Field(default=0.0, ge=0.0, le=1.0)  # how recent?
    evidence_specificity: float = Field(default=0.0, ge=0.0, le=1.0)  # how directly relevant?
    reasoning: str = ""  # 1-sentence explanation of the composite score


class SearchStrategy(_Base):
    """A planned search approach for verifying a claim from a specific angle."""

    angle: str  # e.g. "direct_verification", "negation_search", "source_tracing"
    query: str  # the actual search query to use
    rationale: str  # why this angle is useful


class Finding(_Base):
    id: str
    job_id: str
    claim_id: str
    agent: str
    verdict: FindingVerdict
    severity: Severity = Severity.MINOR
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_breakdown: ConfidenceBreakdown | None = None
    summary: str
    why_wrong: str | None = None
    correct_information: CorrectedInfo | None = None
    reasoning_chain: list[ReasoningStep | VerificationStep] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    reasoning_trace_id: str
    related_finding_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    from_cache: bool = False


class ContentDomain(StrEnum):
    """Domain hint — helps the system prioritize relevant verification strategies."""

    GENERAL = "general"
    ACADEMIC = "academic"
    MEDICAL = "medical"
    LEGAL = "legal"
    FINANCE = "finance"
    TECHNOLOGY = "technology"
    NEWS = "news"
    SCIENCE = "science"


class Job(_Base):
    id: str
    scenario_label: str | None = None
    persona: str | None = None
    pdf_path: str = ""
    input_text: str | None = None
    input_mode: Literal["pdf", "text"] = "pdf"
    content_domain: ContentDomain = ContentDomain.GENERAL
    auto_review: bool = False
    status: Literal[
        "queued", "parsing", "planning", "atomizing", "filtering",
        "reviewing", "verifying", "reporting", "done", "failed",
        "interrupted",
    ] = "queued"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    cost_usd: float = 0.0
    total_tokens: int = 0
    audit_report_md: str | None = None

    # Audit coverage — guards against partial results masquerading as complete.
    # claims_total: claims that entered Phase B verification.
    # claims_audited: claims that received a UnifiedVerifier verdict (incl.
    # downgraded/failed uncertains). audited < total ⇒ partial coverage.
    claims_total: int = 0
    claims_audited: int = 0

    claims: list[Claim] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    traces: list[ReasoningTrace] = Field(default_factory=list)
    evidences: list[Evidence] = Field(default_factory=list)
