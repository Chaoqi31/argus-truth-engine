<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

<img src="web/public/argus-icon.png" alt="Argus" width="96" height="96" />

# Argus

### **The audit layer for AI-generated content.**

Upload anything an AI wrote — a research note, a legal brief, a compliance memo.
Argus returns **every factual claim**, a **verdict on each**, and a
**reviewer-ready reasoning trail** you can click through and verify.

[![Live demo](https://img.shields.io/badge/demo-live-7132f5)](https://argus-truth-engine.vercel.app)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-purple)](https://github.com/langchain-ai/langgraph)
[![Tests](https://img.shields.io/badge/tests-passing-success)](#-testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[🌐 Live demo](https://argus-truth-engine.vercel.app)** · **🎬 Demo video** _(link in submission)_ · **[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## What is Argus

Argus is an audit layer for AI-generated content — built for the people who
*consume* AI output but didn't produce it: compliance officers, legal teams, AI
governance teams, buy-side analysts. You hand it a PDF or paste text; it extracts
every factual claim, verifies each one with autonomous deep research, and returns
a finding, a verdict, a confidence score, and a clickable evidence trail for each.

The existing market sells inline hallucination scoring to the *producers* of AI —
the teams shipping RAG pipelines. Argus serves the *consumer*: the reviewer who
has to trust someone else's AI output before they sign off on it. Its output isn't
a number — it's a reasoning chain a human can read, audit, and file.

Try it now: open the **[live demo](https://argus-truth-engine.vercel.app)** and
hit *Try a sample walkthrough* — it replays a real recorded audit, no API key
needed.

## 🧭 The problem

A compliance officer receives an AI-generated risk memo from a vendor. A lawyer
opens a brief drafted by opposing counsel's chatbot. A buy-side PM gets a research
note from a third-party RAG system. None of them wrote the AI; all of them have
to *trust* it before they act on it.

The problem underneath this is real and documented:

- **1,536** legal cases have now been identified where courts or tribunals
  addressed AI-hallucinated content — and the
  [tracked count](https://www.damiencharlotin.com/hallucinations/)
  (Damien Charlotin, HEC Paris) keeps growing.
- Gartner predicts **30% of generative-AI projects will be abandoned after
  proof-of-concept by the end of 2025** — citing poor data quality, weak risk
  controls, escalating cost, and unclear business value
  ([Gartner, 2024](https://www.gartner.com/en/newsroom/press-releases/2024-07-29-gartner-predicts-30-percent-of-generative-ai-projects-will-be-abandoned-after-proof-of-concept-by-end-of-2025)).

The pattern is the same everywhere: someone acts on AI output they didn't produce
and couldn't fully verify. Argus is the checkpoint between *"the model said it"*
and *"we signed off on it."*

## 🎯 What Argus does

You give it any AI-generated artifact — a PDF, a memo, a research note, a chatbot
transcript. It gives you back **every factual claim**, **every verdict on that
claim**, and **every step of reasoning** that produced the verdict.

| Issue type | What it catches | How it verifies |
|---|---|---|
| 🪤 **Fabricated references** | Papers, cases, filings that don't exist | Autonomous deep research across academic and public registries |
| ❌ **Inaccurate claims** | Factual errors in numbers, names, dates | Cross-verification against ≥2 independent authoritative sources |
| 🪞 **Misrepresented sources** | Paraphrase ≠ source | Fetches the cited URL, compares against the original |
| 📉 **Outdated data** | Numbers superseded by newer releases | Checks latest official data from primary sources |
| 🧩 **Internal contradictions** | Document self-contradicts | Pairwise claim consistency check |

Every finding ships with:

- **Verdict** + severity + confidence
- **Why it's wrong** — a clear explanation of the error
- **Correct information** — what the right answer is, with an authoritative source URL
- **Reasoning chain** — step-by-step action / observation / reasoning trace
- **Evidence trail** — clickable source URLs + snippets
- **Skeptic review** — a second-opinion challenge on the riskiest, least-certain verdicts (see below)

## 👥 Who is this for

**Legal & compliance teams.** Opposing counsel filed a brief drafted with AI.
You need to flag fabricated cases *before* you cite them back. Argus's evidence
trail is built to be filed as part of your response.

**AI governance teams (regulated industries).** Your analysts paste chatbot
outputs into board memos. You need a documented gate between "the model said it"
and "we signed off on it" — the kind regulated industries increasingly demand.

**Investment & research analysts.** A vendor sent you a 40-page AI-generated
research note. You can't read all of it; you can't trust all of it; manually
checking every citation is uneconomic. Argus surfaces only what's wrong.

## 🧭 Where Argus fits

Tools like Patronus, Galileo, and Vectara sell inline scoring to the *producers*
of AI — the teams building RAG pipelines and shipping AI products. Argus sits on
the other side of the handoff: it serves whoever *receives* that output and has
to stand behind it.

|  | Producer-side scoring | **Argus** |
|---|---|---|
| **User** | AI infrastructure teams | **AI output consumers** (compliance, legal, research) |
| **Integration** | API inline in a RAG pipeline | **Upload a file / paste text → audit report** |
| **Primary output** | Score / classifier label | **Reasoning chain + evidence trail + verdict** |
| **Trust artifact** | Numerical score | **Exportable audit pack** (file-able, citable) |

We don't compete on hallucination-classifier accuracy. We compete on **whether a
human can read what we did and trust the verdict.**

## ✨ Reasoning transparency

Every finding ships with both a curated **reasoning chain** (action / observation
/ reasoning triples) and the **full step trace** — every thought, web search, and
page fetch the verifier actually made.

From the bundled investment-research demo, the verifier catching a fabricated
citation:

```
Claim: "a February 2026 Goldman Sachs report titled
        'Silicon Supercycle: The $5 Trillion AI Buildout'…"

  🔍 77 distinct searches — exact title, site:goldmansachs.com, filetype:pdf,
     paraphrases, Scholar / ResearchGate / LinkedIn, negations …
  → no record of any such report, in any form
  → closest real GS piece: "Tracking Trillions: The Assumptions Shaping the
     Scale of the AI Build-Out" — different title, different numbers

  Verdict: fabricated (0.93) — the citation invents both the report title and
  its attribution to Goldman Sachs.
```

And from the bundled legal demo, the **skeptic pass** double-checking a
lower-confidence fabrication before it's trusted:

```
Claim: "In Rivera v. Metro Transit Authority, 412 F.3d 880, 887 (2d Cir. 2009),
        the Second Circuit excused the administrative-exhaustion requirement…"

  🥊 53 reasoning steps — every reporter/caption/citation variant searched
  → no Second Circuit case by that name; 412 F.3d 887 is an Eighth-Circuit
     criminal case (United States v. Hagan)
  Skeptic: no counter-evidence found — the fabrication verdict stands.
```

The trace panel uses **progressive disclosure**: each claim is one collapsed
row showing its verdict and step/search counts; expand a claim to read its
reasoning stream, expand a search to open its result links. Key numbers first,
the full firehose only on request. During a **live audit** the frontend streams
every step over WebSocket as it happens; the sample audits replay the same
recorded trace. Either way reviewers see not just the verdict, but *why* it's
wrong, *what the correct answer is*, and clickable source URLs to check it.

## 🏗️ How it works

A LangGraph state machine orchestrates the pipeline in two phases, split by a
human-in-the-loop review gate:

```
                      ┌─────────────────────────────┐
                      │   📄 Ingest (PDF or text)     │
                      └──────────────┬──────────────┘
                                     ▼
        Phase A — claim extraction (DeepSeek + deterministic, no web)
        ┌────────────────────────────────────────────────────────────┐
        │  parse → 🧠 planner → atomizer → 🎯 checkworthiness           │
        │  → typed atomic claims; opinions / trivia dropped            │
        └──────────────────────────┬─────────────────────────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🚦 Review gate (HITL pause)  │  human picks which
                      │  dedupe + cost cap + select   │  claims to verify
                      └──────────────┬──────────────┘
                                     │  fan-out — selected claims, in parallel
        Phase B — verification       │
                      ┌──────────────┴──────────────┐
                      ▼                             ▼
            ┌────────────────────┐        ┌─────────────────────┐
            │ 🔬 UnifiedVerifier   │        │ 🧩 Consistency       │
            │  ★ MiroMind ★       │        │    Checker           │
            │  live web research  │        │  (DeepSeek, no web)  │
            │  one call / claim   │        │  cross-claim         │
            └─────────┬──────────┘        └─────────┬───────────┘
                      ▼                             │
            ┌────────────────────┐                 │
            │ 🥊 Skeptic           │                 │  challenges only
            │  ★ MiroMind ★       │                 │  low-confidence
            │  2nd-opinion pass   │                 │  high-risk verdicts
            └─────────┬──────────┘                 │
                      └──────────┬─────────────────┘
                                 ▼
                      ┌─────────────────────────────┐
                      │ 📊 Confidence (deterministic) │  3 measured factors
                      │                               │  + soft ≥2-source flag
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  📋 Reporter (DeepSeek)       │
                      │  → executive summary + PDF    │
                      └─────────────────────────────┘
```

**The UnifiedVerifier and the Skeptic pass are the two steps that call MiroMind.**
The verifier has full autonomy over its verification strategy — which sources to
check, which tools to use (web search, fetch, code), and how many steps to take.
We constrain only the *output format* (verdict + why_wrong + correct_information
+ reasoning_chain) to guarantee transparency. Non-prescriptive **domain hints**
suggest relevant authoritative sources by claim type without forcing a fixed
search order.

**Skeptic challenge pass.** After the verifier reaches a verdict, any *high-risk*
finding (fabricated / inaccurate / outdated / misrepresented) the verifier was
**not confident about** — confidence below `skeptic_confidence_threshold`
(default `0.85`) — gets a second, adversarial MiroMind pass. It hunts for
counter-evidence the verifier might have missed: title variants, newer sources, a
misread citation. If it finds credible counter-evidence it downgrades the verdict
to *uncertain* and caps confidence; otherwise it confirms. Confident verdicts are
left alone, so the extra deep-research call is spent **only where a second opinion
can change the outcome** — not on every accusation.

Everything else runs off the critical path: planner, atomizer, checkworthiness,
the consistency checker, and the reporter all run on **DeepSeek** (cheap, no
web); parse, the review gate, and confidence are **deterministic**. That keeps
MiroMind's deep-research budget on the two steps that actually need the open web.

### Engineering controls

- **`BoundedRunner`** — semaphore-bound concurrency per agent
- **`BudgetTracker`** — hard USD cap, aborts mid-flight before runaway spend
- **confidence-gated skeptic** — second-opinion calls fire only on under-confident high-risk verdicts, capping cost while protecting against false accusations
- **`retry_on_transient`** — exponential backoff for `429` / `5xx` from upstream
- **`make_idempotency_key`** — deterministic job-keyed idempotency
- **`json-repair`** — heuristic LLM JSON recovery + array-unwrap for MiroMind quirks
- **`SSEDecoder`** — stateful stream parser that buffers across network chunk boundaries, so an SSE event split across two TCP/HTTP chunks is reassembled, never dropped — faithful trace text and intact evidence URLs
- **soft ≥2-source rule** — verdicts resting on too few independent sources are confidence-capped and flagged for manual review, not silently discarded

### Storage & live bus

SQLAlchemy 2.0 async ORM with aiosqlite (dev/tests) and asyncpg+Postgres (prod),
Alembic migrations shared across both backends. A pluggable `TraceBus` ships
live agent events over WebSocket — `InProcessBus` for single-instance, Redis
pub/sub for multi-instance.

## 🚀 Quickstart

### Option A — Web UI

```bash
# 1. Backend
cp .env.example .env       # fill in ARGUS_MIROMIND_API_KEY (or skip — the UI accepts BYOK)
uv sync
uv run argus serve --host 127.0.0.1 --port 8080

# 2. Frontend
cd web && pnpm install && pnpm dev

# 3. Open http://127.0.0.1:3000
#    Click "Try a sample walkthrough" to replay a real recorded audit — no API key needed.
```

The frontend proxies `/api/argus/*` to `http://localhost:8080` by default
(override with `ARGUS_API_HOST`).

On macOS, WeasyPrint may need Homebrew's Pango/Cairo libraries on the dynamic
loader path before the PDF report endpoint is used:

```bash
DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run argus serve --host 127.0.0.1 --port 8080
```

### Option B — CLI

```bash
uv sync
export ARGUS_MIROMIND_API_KEY=sk-…

uv run argus audit examples/sample-report.pdf \
  -o findings.json \
  --budget-usd 50
```

### Option C — HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/healthz` | health probe |
| `POST` | `/jobs` | upload PDF (multipart `pdf=…`) → `{job_id}` 202 |
| `POST` | `/jobs/text` | submit raw text → `{job_id}` 202 |
| `GET`  | `/jobs/{job_id}` | poll status or fetch the final Job JSON |
| `GET`  | `/jobs/{job_id}/report.pdf` | download the audit report PDF |
| `WS`   | `/ws/jobs/{job_id}/trace` | history replay + live event stream |

## 🧰 Stack

| Layer | Choice |
|---|---|
| **Models** | MiroMind `mirothinker-1-7-deepresearch` (per-claim verifier + skeptic challenge — the steps that touch the live web) + DeepSeek `deepseek-chat` (planner / atomizer / checkworthiness / consistency / reporter) |
| **Orchestration** | LangGraph 1.x StateGraph with parallel fan-out + reducer fan-in |
| **Backend** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + raw SSE |
| **Persistence** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **Reports** | Jinja2 + WeasyPrint (HTML→PDF) |
| **Live bus** | WebSocket · pluggable `TraceBus` (in-process / Redis pub/sub) |
| **Frontend** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |

## 🧪 Testing

```bash
uv run pytest -q          # backend tests
uv run mypy src/argus     # strict
uv run ruff check .       # lint
cd web && pnpm test       # frontend tests
```

## 📜 License

[MIT](LICENSE)

## 🙏 Acknowledgements

- **[MiroMind](https://platform.miromind.ai/)** for the `mirothinker-1-7-deepresearch` model
- **[UCWS Singapore](https://www.ucws.sg/)** for hosting the hackathon
- **[LangGraph](https://github.com/langchain-ai/langgraph)** for the orchestration primitives
</content>
</invoke>
