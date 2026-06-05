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
    """The verdict a verifier assigns to a single claim.

    The distinctions matter — they drive severity and the report copy:

    - OK: the claim checks out against the evidence.
    - FABRICATED: the cited source/reference does not exist (or the event never
      happened) — nothing real to point at.
    - INACCURATE: the source exists but the claim states it wrong (factual error).
    - MISMATCH / MISREPRESENTED: the claim contradicts or misstates what the
      cited source actually says (the source exists and was consulted).
    - STALE: the claim was true but has simply aged out / gone out of date.
    - SUPERSEDED: the claim has been explicitly replaced by a newer fact.
    - OUTDATED: newer data exists than the figure the claim cites.
    - CONTRADICTION: the document contradicts *itself* (two claims can't both
      hold) — a document-internal flaw, not an external-evidence mismatch.
    - UNSUPPORTED_INFERENCE / OVERREACH: the stated conclusion is not supported
      by the document's own premises (a logical leap), again document-internal.
    - PARTIAL_MATCH: the claim is only partially supported by the evidence.
    - UNCERTAIN: the verifier could not determine the truth of the claim.

    Note: the UnifiedVerifier prompt currently emits only OK / FABRICATED /
    INACCURATE / OUTDATED / MISREPRESENTED / UNCERTAIN; CONTRADICTION,
    UNSUPPORTED_INFERENCE and OVERREACH come from the consistency checker.
    PARTIAL_MATCH, MISMATCH, STALE and SUPERSEDED are defined here but are not
    currently produced by any prompt.
    """

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
    reasoning: str = ""  # 1-sentence description of the measured factors


class EvidenceQuality(_Base):
    """Per-evidence quality signals used to explain why a source is trusted."""

    evidence_id: str
    authority: float = Field(default=0.0, ge=0.0, le=1.0)
    independence: float = Field(default=0.0, ge=0.0, le=1.0)
    freshness: float = Field(default=0.0, ge=0.0, le=1.0)
    directness: float = Field(default=0.0, ge=0.0, le=1.0)
    role: str = ""
    rationale: str = ""


class ClaimCoverage(_Base):
    """How evidence supports/refutes a specific fragment of the claim."""

    claim_fragment: str
    relation: str
    evidence_ids: list[str] = Field(default_factory=list)
    reason: str = ""


class ComputationValue(_Base):
    """One value extracted for a numerical/date verification check."""

    label: str
    value: str
    unit: str = ""
    source_evidence_id: str | None = None


class ComputationCheck(_Base):
    """Reproducible numeric/date check behind a verifier judgment."""

    kind: Literal["numeric", "date"]
    claimed_value: str = ""
    extracted_values: list[ComputationValue] = Field(default_factory=list)
    formula: str = ""
    computed_value: str = ""
    tolerance: str = ""
    judgment: str = ""
    rationale: str = ""


class SkepticCounterevidence(_Base):
    """A possible counterexample found by the skeptic pass."""

    source: str = ""
    url: str | None = None
    snippet: str = ""
    relevance: str = ""


class SkepticReview(_Base):
    """Independent challenge pass over a high-risk verifier conclusion."""

    status: Literal["no_counterevidence", "counterevidence_found", "inconclusive"]
    summary: str
    recommended_verdict: FindingVerdict | None = None
    counterevidence: list[SkepticCounterevidence] = Field(default_factory=list)


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
    evidence_quality: list[EvidenceQuality] = Field(default_factory=list)
    coverage: list[ClaimCoverage] = Field(default_factory=list)
    skeptic_review: SkepticReview | None = None
    computation_check: ComputationCheck | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    reasoning_trace_id: str
    related_finding_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    from_cache: bool = False
    # User-facing caveats surfaced as badges (e.g. "single source — verify
    # manually" when a verdict rests on fewer than 2 independent sources).
    flags: list[str] = Field(default_factory=list)


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


class StageFilteredClaim(_Base):
    claim_id: str | None = None
    text: str
    reason: str


class Stage(_Base):
    key: str
    name: str
    engine: Literal["deepseek", "miromind", "deterministic"]
    summary: str
    metrics: dict[str, int] = Field(default_factory=dict)
    strategy: str | None = None
    filtered_claims: list[StageFilteredClaim] | None = None


class BenchmarkExpectedClaim(_Base):
    """Demo-fixture-only ground truth — see :class:`BenchmarkSpec`."""

    claim_id: str
    verdict: FindingVerdict
    rationale: str


class BenchmarkSpec(_Base):
    """Planted-error answer key for the demo sample fixture ONLY.

    Never populated on live audits (always ``None`` there); it exists so the
    demo ``web/public/sample-findings.json`` can carry a known-answer benchmark
    that the frontend benchmark panel scores the verifier against. This is not a
    live capability — do not mistake it for a metric measured on real jobs.
    """

    name: str
    expected_claims: list[BenchmarkExpectedClaim] = Field(default_factory=list)


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
    stages: list[Stage] = Field(default_factory=list)
    # Demo-fixture-only ground truth; always None on live jobs. See BenchmarkSpec.
    benchmark: BenchmarkSpec | None = None
