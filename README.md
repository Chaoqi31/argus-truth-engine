<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# 🛡️ Argus

### **The audit layer for AI-generated content.**

*Patronus and Galileo help you build AI you can ship.*
*Argus helps you trust AI someone else shipped to you.*

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-purple)](https://github.com/langchain-ai/langgraph)
[![Tests](https://img.shields.io/badge/tests-passing-success)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## 🧭 The problem

A compliance officer receives an AI-generated risk memo from a vendor. A lawyer
opens a brief drafted by opposing counsel's chatbot. A buy-side PM gets a research
note from a third-party RAG system. None of them wrote the AI; all of them have
to *trust* it before they act on it.

The problem underneath this is real and documented:

- **1,400+** court filings have now been caught citing fabricated, AI-hallucinated
  cases — and the [tracked count](https://www.damiencharlotin.com/hallucinations/)
  (Damien Charlotin, HEC Paris) keeps growing by several every day.
- Gartner predicts **30% of generative-AI projects will be abandoned after
  proof-of-concept by the end of 2025** — citing poor data quality, weak risk
  controls, escalating cost, and unclear business value
  ([Gartner, 2024](https://www.gartner.com/en/newsroom/press-releases/2024-07-29-gartner-predicts-30-percent-of-generative-ai-projects-will-be-abandoned-after-proof-of-concept-by-end-of-2025)).

The pattern is the same everywhere: someone acts on AI output they didn't produce
and couldn't fully verify.

The existing market (Patronus, Galileo, Vectara) sells inline scoring to the
*producers* of AI — the teams shipping RAG pipelines and AI products. Nobody
sells to the *consumer* of AI output. Argus does.

## 🎯 What Argus does

You give it any AI-generated artifact — a PDF, a memo, a research note, a chatbot
transcript. It gives you back **every factual claim**, **every verdict on that
claim**, and **every step of reasoning** that produced the verdict.

| Issue type | What it catches | How it verifies |
|---|---|---|
| 🪤 **Fabricated references** | Papers, cases, filings that don't exist | Autonomous deep research across academic and public registries |
| ❌ **Inaccurate claims** | Factual errors in numbers, names, dates | Cross-verification against ≥2 independent authoritative sources |
| 🪞 **Misrepresented sources** | Paraphrase ≠ source | Fetches the cited URL, compares against original |
| 📉 **Outdated data** | Numbers superseded by newer releases | Checks latest official data from primary sources |
| 🧩 **Internal contradictions** | Document self-contradicts | Pairwise claim consistency check |

Every finding ships with:
- **Verdict** + severity + confidence
- **Why it's wrong** — clear explanation of the error
- **Correct information** — what the right answer is, with authoritative source URL
- **Reasoning chain** — step-by-step action/observation/reasoning trace
- **Evidence trail** — clickable source URLs + snippets

## 👥 Who is this for

**Legal & compliance teams.** Opposing counsel filed a brief drafted with AI.
You need to flag fabricated cases *before* you cite them back. Argus's evidence
trail is built to be filed as part of your response.

**AI governance teams (regulated industries).** Your analysts paste ChatGPT
outputs into board memos. You need a checkpoint between "the model said it" and
"we signed off on it" — a documented gate that regulated industries increasingly
demand. Argus is that audit gate.

**Investment & research analysts.** A vendor sent you a 40-page AI-generated
research note. You can't read all of it; you can't trust all of it; manually
checking every citation is uneconomic. Argus surfaces only what's wrong.

## 🆚 vs. Patronus / Galileo / Vectara

|  | Patronus / Galileo / Vectara | **Argus** |
|---|---|---|
| **Buyer** | AI infrastructure teams | **AI output consumers** (compliance, legal, research) |
| **Integration** | API inline in RAG pipeline | **Upload file / paste text → audit report** |
| **Primary output** | Score / classifier label | **Full reasoning chain + evidence trail + verdict** |
| **Pricing model** | Per token / per call | **Per audit / per case** |
| **Trust artifact** | Numerical score | **Exportable PDF audit report** (file-able, citable) |

We don't compete on hallucination-classifier accuracy. We compete on **whether a
human can read what we did and trust the verdict.**

## ✨ Reasoning transparency

Every finding includes a structured **reasoning chain** — not raw model
thinking, but a curated sequence of action/observation/reasoning triples
that show exactly how the verdict was reached:

```
Step 1: Checked BEA's Q3 2024 Advance Estimate
  → Found: GDP growth 2.8%, contradicts claimed 1.6%
  → Reasoning: Initial official figure already differs from claim

Step 2: Checked BEA's Q3 2024 Second Estimate
  → Found: Still 2.8%
  → Reasoning: Two estimates agree, 1.6% is definitively wrong

Step 3: Checked BEA's Q3 2024 Third (Final) Estimate
  → Found: Revised to 3.1%
  → Reasoning: Most current official figure confirms the error

Step 4: Traced origin of 1.6% figure
  → Found: Belongs to Q1 2024, not Q3
  → Reasoning: Claim conflated Q1 and Q3 data — inaccurate, not fabricated
```

During a **live audit**, the frontend streams every step over WebSocket as it
happens; in the **sample audit**, you replay the same recorded trace step by
step. Either way, reviewers see not just the verdict, but *why* it's wrong and
*what the correct answer is* — with clickable source URLs for independent
verification.

## 🏗️ How it works

A LangGraph state machine orchestrates the pipeline in two phases:

```
                      ┌─────────────────────────────┐
                      │   📄 Ingest (PDF or text)     │
                      └──────────────┬──────────────┘
                                     ▼
                 Phase A — Preprocessing (DeepSeek, cheap)
                      ┌─────────────────────────────┐
                      │  🧠 Planner → Atomizer        │
                      │  → typed atomic claims        │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🎯 CheckWorthiness gate      │
                      │  → drops trivial claims       │
                      └──────────────┬──────────────┘
                                     │
                 Phase B — Verification (MiroMind, deep research)
                                     │  fan-out (all claims)
                      ┌──────────────┴──────────────┐
                      ▼                             ▼
               ┌─────────────┐             ┌────────────┐
               │  Unified    │             │Consistency │
               │  Verifier   │             │  Checker   │
               │ (per claim) │             │ (pairwise) │
               └──────┬──────┘             └─────┬──────┘
                      └──────────┬───────────────┘
                                 ▼
                      ┌─────────────────────────────┐
                      │  📊 Confidence Calculator     │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  📋 Reporter → audit report   │
                      │  → executive summary + PDF    │
                      └─────────────────────────────┘
```

The **UnifiedVerifier** has full autonomy over its verification strategy —
it chooses which sources to check, which APIs to query, and how many steps
to take. We constrain only the *output format* (verdict + why_wrong +
correct_information + reasoning_chain) to guarantee transparency.
Non-prescriptive **domain hints** suggest relevant authoritative sources
based on claim type and content domain, without forcing a fixed search order.

Atomizer / CheckWorthiness run on DeepSeek (cheap) so MiroMind spend stays
in the verifier where it matters. A single-claim smoke test costs ~$0.16 in
model calls.

### Engineering controls

- **`BoundedRunner`** — semaphore-bound concurrency per agent
- **`BudgetTracker`** — hard USD cap, aborts mid-flight before runaway spend
- **`retry_on_transient`** — exponential backoff for `429` / `5xx` from upstream
- **`make_idempotency_key`** — deterministic job-keyed idempotency
- **`json-repair`** — heuristic LLM JSON recovery + array-unwrap for MiroMind quirks

### Storage & live bus

SQLAlchemy 2.0 async ORM with aiosqlite (dev/tests) and asyncpg+Postgres (prod),
Alembic migrations shared across both backends. A pluggable `TraceBus` ships
live agent events over WebSocket — `InProcessBus` for single-instance, Redis
pub/sub for multi-instance.

## 🚀 Quickstart

### Option A — Web UI

```bash
# 1. Backend
cp .env.example .env       # fill in ARGUS_MIROMIND_API_KEY (or skip — UI accepts BYOK)
uv sync
uv run argus serve --host 127.0.0.1 --port 8080

# 2. Frontend
cd web && pnpm install && pnpm dev

# 3. Open http://localhost:3000
#    Click "…or try the sample audit" to see a curated audit without an API key.
```

### Option B — CLI

```bash
uv sync
export ARGUS_MIROMIND_API_KEY=sk_…

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
| `GET`  | `/jobs/{job_id}` | poll status or fetch final Job JSON |
| `GET`  | `/jobs/{job_id}/report.pdf` | download the audit report PDF |
| `WS`   | `/ws/jobs/{job_id}/trace` | history replay + live event stream |

## 🧰 Stack

| Layer | Choice |
|---|---|
| **Models** | MiroMind `mirothinker-1-7-deepresearch` (verifier/consistency/reporter) + DeepSeek (atomizer/checkworthiness) |
| **Orchestration** | LangGraph 1.x StateGraph with parallel fan-out + reducer fan-in |
| **Backend** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + raw SSE |
| **Persistence** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **Reports** | Jinja2 + WeasyPrint (HTML→PDF) |
| **Live bus** | WebSocket · pluggable `TraceBus` (in-process / Redis pub/sub) |
| **Frontend** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |

## 🧪 Testing

```bash
uv run pytest -q          # 171 passing
uv run mypy src/argus     # strict
uv run ruff check .       # lint
cd web && pnpm test       # vitest
```

## 📜 License

[MIT](LICENSE)

## 🙏 Acknowledgements

- **[MiroMind](https://platform.miromind.ai/)** for the `mirothinker-1-7-deepresearch` model
- **[UCWS Singapore](https://www.ucws.sg/)** for hosting the hackathon
- **[LangGraph](https://github.com/langchain-ai/langgraph)** for the orchestration primitives
