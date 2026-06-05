<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

<img src="web/public/argus-icon.png" alt="Argus" width="96" height="96" />

# Argus

### **The audit layer for AI-generated content.**

Upload anything an AI wrote — a research note, a legal brief, a compliance memo.
Argus returns **every factual claim**, a **verdict** on each, and a
**reviewer-ready reasoning trail** you can click through and verify.

[![Live demo](https://img.shields.io/badge/demo-live-7132f5)](https://argus-truth-engine.vercel.app)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-purple)](https://github.com/langchain-ai/langgraph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[🌐 Live demo](https://argus-truth-engine.vercel.app)** · **🎬 Demo video** _(link in submission)_ · **[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## What is Argus

Argus audits AI-generated content for the people who *consume* it but didn't write
it — compliance officers, legal teams, AI governance teams, buy-side analysts. Hand
it a PDF or paste text; it extracts every factual claim, verifies each with
autonomous deep research, and returns a verdict, a confidence score, and a
clickable evidence trail for each. The output isn't a score — it's a reasoning
chain a human can read, audit, and file.

Try it: open the **[live demo](https://argus-truth-engine.vercel.app)** and hit
*Try a sample walkthrough* — it replays a real recorded audit, no API key needed.

## 🧭 The problem

A compliance officer gets an AI-generated risk memo from a vendor. A lawyer opens
a brief drafted by opposing counsel's chatbot. A PM gets a research note from a
third-party RAG system. None of them wrote the AI; all of them have to *trust* it
before they act.

It's a real, documented problem:

- **1,536** legal cases have been logged where courts addressed AI-hallucinated
  content — and the [tracked count](https://www.damiencharlotin.com/hallucinations/)
  (Damien Charlotin, HEC Paris) keeps growing.
- Gartner predicts **30% of generative-AI projects will be abandoned after PoC by
  the end of 2025** — poor data quality, weak risk controls, escalating cost
  ([Gartner, 2024](https://www.gartner.com/en/newsroom/press-releases/2024-07-29-gartner-predicts-30-percent-of-generative-ai-projects-will-be-abandoned-after-proof-of-concept-by-end-of-2025)).

Argus is the checkpoint between *"the model said it"* and *"we signed off on it."*

## 🎯 What Argus does

Give it any AI-generated artifact — a PDF, a memo, a research note, a transcript.
It returns **every factual claim**, a **verdict** on each, and **every step of
reasoning** behind it.

| Issue type | What it catches | How it verifies |
|---|---|---|
| 🪤 **Fabricated references** | Papers, cases, filings that don't exist | Autonomous deep research across academic and public registries |
| ❌ **Inaccurate claims** | Errors in numbers, names, dates | Cross-verification against ≥2 independent authoritative sources |
| 🪞 **Misrepresented sources** | Paraphrase ≠ source | Fetches the cited URL, compares against the original |
| 📉 **Outdated data** | Numbers superseded by newer releases | Checks the latest official data from primary sources |
| 🧩 **Internal contradictions** | Document self-contradicts | Pairwise claim consistency check |

Every finding ships with:

- **Verdict** + severity + confidence
- **Why it's wrong** + the **correct answer**, with an authoritative source URL
- **Reasoning chain** — action / observation / reasoning steps
- **Evidence trail** — clickable source URLs + snippets
- **Skeptic review** — a second opinion on the riskiest, least-certain verdicts

## 👥 Who is this for

- **Legal & compliance** — flag fabricated cases in an AI-drafted brief *before*
  you cite them back; the evidence trail files as part of your response.
- **AI governance (regulated industries)** — a documented gate between "the model
  said it" and "we signed off on it."
- **Investment & research** — a 40-page AI research note you can't fully trust;
  Argus surfaces only what's wrong.

## ✨ Reasoning transparency

Every finding ships with a curated **reasoning chain** (action / observation /
reasoning) *and* the **full step trace** — every thought, search, and fetch the
verifier actually made.

The verifier catching a fabricated citation:

```
Claim: "a February 2026 Goldman Sachs report titled
        'Silicon Supercycle: The $5 Trillion AI Buildout'…"

  🔍 77 distinct searches — exact title, site:goldmansachs.com, paraphrases,
     Scholar / ResearchGate / LinkedIn, negations …
  → no record of any such report, in any form

  Verdict: fabricated (0.93) — the citation invents both the report title and
  its attribution to Goldman Sachs.
```

The **skeptic pass** double-checking a low-confidence fabrication before it's trusted:

```
Claim: "In Rivera v. Metro Transit Authority, 412 F.3d 880, 887 (2d Cir. 2009)…"

  🥊 53 reasoning steps — every reporter/caption/citation variant searched
  → no Second Circuit case by that name; 412 F.3d 887 is an Eighth-Circuit
     criminal case (United States v. Hagan)
  Skeptic: no counter-evidence — the fabrication verdict stands.
```

The trace uses **progressive disclosure**: each claim is one row (verdict + step
counts); expand to read its reasoning, expand a search to open its result links.
A **live audit** streams every step over WebSocket; the sample audits replay the
same recorded trace.

## 🏗️ How it works

A LangGraph state machine runs the pipeline in two phases, split by a
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

**UnifiedVerifier and Skeptic are the two steps that call MiroMind.** The verifier
has full autonomy over its strategy — which sources, which tools (search / fetch /
code), how many steps; we constrain only the *output format* (verdict + why_wrong
+ correct_information + reasoning_chain) to guarantee transparency.

**Skeptic challenge pass.** Any *high-risk* verdict the verifier wasn't confident
about (confidence below `skeptic_confidence_threshold`, default `0.85`) gets a
second, adversarial MiroMind pass that hunts for counter-evidence. If it finds
some, the verdict is downgraded to *uncertain*; if not, it's confirmed. Confident
verdicts are left alone — so the extra deep-research call is spent only where a
second opinion can change the outcome.

Everything else runs on **DeepSeek** (planner, atomizer, checkworthiness,
consistency, reporter — cheap, no web) or is **deterministic** (parse, review
gate, confidence), keeping MiroMind's budget on the two steps that need the open web.

### Engineering controls

- **`BoundedRunner`** — semaphore-bound concurrency per agent
- **`BudgetTracker`** — hard USD cap, aborts mid-flight before runaway spend
- **confidence-gated skeptic** — second-opinion calls fire only on under-confident high-risk verdicts: caps cost, guards against false accusations
- **`retry_on_transient`** — exponential backoff for upstream `429` / `5xx`
- **`make_idempotency_key`** — deterministic job-keyed idempotency
- **`json-repair`** — heuristic LLM JSON recovery + array-unwrap for MiroMind quirks
- **`SSEDecoder`** — stateful parser that reassembles SSE events split across network chunks, so trace text and evidence URLs are never dropped
- **soft ≥2-source rule** — verdicts on too few independent sources are confidence-capped and flagged, not silently dropped

### Storage & live bus

SQLAlchemy 2.0 async ORM (aiosqlite in dev/tests, asyncpg + Postgres in prod;
shared Alembic migrations). A pluggable `TraceBus` ships live agent events over
WebSocket — `InProcessBus` for single-instance, Redis pub/sub for multi-instance.

## 🚀 Quickstart

```bash
# Backend — fill ARGUS_MIROMIND_API_KEY in .env, or skip (the UI accepts BYOK)
cp .env.example .env
uv sync
uv run argus serve --host 127.0.0.1 --port 8080

# Frontend
cd web && pnpm install && pnpm dev

# Open http://127.0.0.1:3000 → click "Try a sample walkthrough" to replay a real
# recorded audit, no API key needed.
```

The frontend proxies `/api/argus/*` to `http://localhost:8080` (override with
`ARGUS_API_HOST`). On macOS, WeasyPrint needs Homebrew's Pango/Cairo on the loader
path for PDF export:
`DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run argus serve …`.

## 🧰 Stack

| Layer | Choice |
|---|---|
| **Models** | MiroMind `mirothinker-1-7-deepresearch` (per-claim verifier + skeptic — the steps that touch the live web) + DeepSeek `deepseek-chat` (planner / atomizer / checkworthiness / consistency / reporter) |
| **Orchestration** | LangGraph 1.x StateGraph — parallel fan-out + reducer fan-in |
| **Backend** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + raw SSE |
| **Persistence** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **Reports** | Jinja2 + WeasyPrint (HTML→PDF) |
| **Live bus** | WebSocket · pluggable `TraceBus` (in-process / Redis pub/sub) |
| **Frontend** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |

## 🧪 Testing

```bash
uv run pytest -q          # backend tests
uv run mypy src/argus     # strict types
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
