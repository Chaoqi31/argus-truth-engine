"""Core domain models for Argus.

These models represent the data flowing through the pipeline: PDFs become Claims,
Claims become Findings (with attached ReasoningTraces), and the final output is
the union of all of those plus the per-Step events MiroMind streamed back.

Everything but the `Job` aggregate is an immutable value: a revised finding is
a copy under the same id, never an edit a concurrent stage could observe.
"""
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import uuid4

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
    """The verdict on a single claim.

    The UnifiedVerifier judges a claim against outside evidence:

    - OK: the claim checks out against the evidence.
    - FABRICATED: the cited source or event does not exist.
    - INACCURATE: the source exists but the claim states it wrong.
    - OUTDATED: newer data supersedes the figure the claim cites.
    - MISREPRESENTED: the claim distorts what its cited source says.
    - UNCERTAIN: the claim could not be verified either way.

    The consistency checker judges the document against itself:

    - CONTRADICTION: two claims in the document cannot both hold.
    - UNSUPPORTED_INFERENCE: a conclusion does not follow from its premises.
    - OVERREACH: a conclusion claims more than its cited data supports.
    """

    OK = "ok"
    FABRICATED = "fabricated"
    INACCURATE = "inaccurate"
    OUTDATED = "outdated"
    MISREPRESENTED = "misrepresented"
    UNCERTAIN = "uncertain"
    CONTRADICTION = "contradiction"
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


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class _Base(BaseModel):
    # Serialization always emits defaulted fields, so the web's generated
    # types mark them required.
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


class Frozen(_Base):
    model_config = ConfigDict(frozen=True)


class Claim(Frozen):
    id: str
    text: str
    page: int = Field(default=1, ge=0)
    span: tuple[int, int]
    type: ClaimType
    importance: Literal["high", "medium", "low"]
    extracted_metadata: dict[str, Any] = Field(default_factory=dict)
    parent_claim_id: str | None = None
    # The passage around the claim that the verifier is shown. Set when the
    # claim is shortlisted, so verification never needs the source document.
    context: str = ""

    @model_validator(mode="after")
    def _check_span(self) -> Claim:
        start, end = self.span
        if start < 0 or end < start:
            raise ValueError(f"invalid span {self.span!r}")
        return self


class Evidence(Frozen):
    id: str
    source_type: EvidenceSource
    url: str | None = None
    citation: str
    snippet: str = ""
    retrieved_at: datetime = Field(default_factory=datetime.utcnow)
    retrieved_by_step_id: str


class Step(Frozen):
    id: str
    trace_id: str
    sequence: int = Field(ge=0)
    type: StepType
    summary: str
    content: dict[str, Any] = Field(default_factory=dict)
    parent_step_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ReasoningTrace(Frozen):
    id: str
    claim_id: str
    agent: str
    miromind_response_id: str
    started_at: datetime
    completed_at: datetime | None = None
    total_tokens: int = 0
    reasoning_tokens: int = 0
    num_search_queries: int = 0
    steps: tuple[Step, ...] = ()


class CorrectedInfo(Frozen):
    """What the correct information actually is, with authoritative source."""

    value: str
    source: str
    url: str | None = None
    retrieved_date: str | None = None


class VerificationStep(Frozen):
    """One step in a verification chain — action/observation/reasoning triple."""

    action: str
    observation: str
    reasoning: str


class ConfidenceBreakdown(Frozen):
    """Decomposed confidence — explains WHY confidence is at a certain level."""

    source_agreement: float = Field(default=0.0, ge=0.0, le=1.0)  # do sources agree?
    source_authority: float = Field(default=0.0, ge=0.0, le=1.0)  # how authoritative?
    evidence_freshness: float = Field(default=0.0, ge=0.0, le=1.0)  # how recent?
    reasoning: str = ""  # 1-sentence description of the measured factors


class EvidenceQuality(Frozen):
    """Per-evidence quality signals used to explain why a source is trusted."""

    evidence_id: str
    authority: float = Field(default=0.0, ge=0.0, le=1.0)
    independence: float = Field(default=0.0, ge=0.0, le=1.0)
    freshness: float = Field(default=0.0, ge=0.0, le=1.0)
    directness: float = Field(default=0.0, ge=0.0, le=1.0)
    role: str = ""
    rationale: str = ""


class ClaimCoverage(Frozen):
    """How evidence supports/refutes a specific fragment of the claim."""

    claim_fragment: str
    relation: str
    evidence_ids: tuple[str, ...] = ()
    reason: str = ""


class ComputationValue(Frozen):
    """One value extracted for a numerical/date verification check."""

    label: str
    value: str
    unit: str = ""
    source_evidence_id: str | None = None


class ComputationCheck(Frozen):
    """Reproducible numeric/date check behind a verifier judgment."""

    kind: Literal["numeric", "date"]
    claimed_value: str = ""
    extracted_values: tuple[ComputationValue, ...] = ()
    formula: str = ""
    computed_value: str = ""
    tolerance: str = ""
    judgment: str = ""
    rationale: str = ""


class SkepticCounterevidence(Frozen):
    """A possible counterexample found by the skeptic pass."""

    source: str = ""
    url: str | None = None
    snippet: str = ""
    relevance: str = ""


class SkepticReview(Frozen):
    """Independent challenge pass over a high-risk verifier conclusion."""

    status: Literal["no_counterevidence", "counterevidence_found", "inconclusive"]
    summary: str
    recommended_verdict: FindingVerdict | None = None
    counterevidence: tuple[SkepticCounterevidence, ...] = ()


class Finding(Frozen):
    id: str
    claim_id: str
    agent: str
    verdict: FindingVerdict
    severity: Severity = Severity.MINOR
    confidence: float = Field(ge=0.0, le=1.0)
    confidence_breakdown: ConfidenceBreakdown | None = None
    summary: str
    why_wrong: str | None = None
    correct_information: CorrectedInfo | None = None
    reasoning_chain: tuple[VerificationStep, ...] = ()
    evidence_quality: tuple[EvidenceQuality, ...] = ()
    coverage: tuple[ClaimCoverage, ...] = ()
    skeptic_review: SkepticReview | None = None
    computation_check: ComputationCheck | None = None
    evidence_ids: tuple[str, ...] = ()
    reasoning_trace_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    from_cache: bool = False
    # User-facing caveats surfaced as badges (e.g. "single source — verify
    # manually" when a verdict rests on fewer than 2 independent sources).
    flags: tuple[str, ...] = ()


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


class StageFilteredClaim(Frozen):
    claim_id: str | None = None
    text: str
    reason: str


class Stage(Frozen):
    key: str
    name: str
    engine: Literal["deepseek", "miromind", "deterministic"]
    summary: str
    metrics: dict[str, int] = Field(default_factory=dict)
    filtered_claims: tuple[StageFilteredClaim, ...] = ()


class BenchmarkExpectedClaim(Frozen):
    """Demo-fixture-only ground truth — see :class:`BenchmarkSpec`."""

    claim_id: str
    verdict: FindingVerdict
    rationale: str


class BenchmarkSpec(Frozen):
    """Planted-error answer key for the demo sample fixture ONLY.

    Never populated on live audits (always ``None`` there); it exists so the
    demo ``web/public/sample-findings.json`` can carry a known-answer benchmark
    that the frontend benchmark panel scores the verifier against. This is not a
    live capability — do not mistake it for a metric measured on real jobs.
    """

    name: str
    expected_claims: tuple[BenchmarkExpectedClaim, ...] = ()


JobStatus = Literal["running", "awaiting_review", "done", "failed"]


class FailureKind(StrEnum):
    BUDGET = "budget"  # the job's spend cap was reached
    INTERRUPTED = "interrupted"  # the run was cut off: a restart or a cancel
    ERROR = "error"  # the input or a provider made the audit impossible


class Failure(Frozen):
    kind: FailureKind
    message: str


class Job(_Base):
    id: str
    scenario_label: str | None = None
    persona: str | None = None
    pdf_path: str = ""
    input_text: str | None = None
    input_mode: Literal["pdf", "text"] = "pdf"
    content_domain: ContentDomain = ContentDomain.GENERAL
    auto_review: bool = False
    status: JobStatus = "running"
    failure: Failure | None = None
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
