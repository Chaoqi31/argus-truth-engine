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
[![Tests](https://img.shields.io/badge/tests-122_passing-success)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## 🧭 The problem

A compliance officer receives an AI-generated risk memo from a vendor. A lawyer
opens a brief drafted by opposing counsel's chatbot. A buy-side PM gets a research
note from a third-party RAG system. None of them wrote the AI; all of them have
to *trust* it before they act on it.

The numbers underneath this problem are not subtle:

- **$67.4B** in enterprise losses to AI hallucinations in 2024
- **1,353+** documented court cases involving AI hallucinations (and accelerating)
- **76%** of enterprises still run human review to catch them — at ~$14K/employee/year
- **30%** of enterprise AI projects will be abandoned by 2026 over trust issues (Gartner)

The existing market (Patronus, Galileo, Vectara) sells inline scoring to the
*producers* of AI — the teams shipping RAG pipelines and AI products. Nobody
sells to the *consumer* of AI output. Argus does.

## 🎯 What Argus does

You give it any AI-generated artifact — a PDF, a memo, a research note, a chatbot
transcript. It gives you back **every factual claim**, **every verdict on that
claim**, and **every step of reasoning** that produced the verdict.

| Issue type | What it catches | How it verifies |
|---|---|---|
| 🪤 **Fabricated references** | Papers, cases, filings that don't exist | Crossref / arXiv / SSRN / public registries |
| 🪞 **Misrepresented sources** | Paraphrase ≠ source | Fetches the cited URL, paragraph-by-paragraph compare |
| 📉 **Outdated data** | Numbers superseded by newer data | FRED / World Bank / SEC EDGAR / IMF |
| 🧩 **Internal contradictions** | Document self-contradicts | Pairwise claim consistency check |

Every finding ships with verdict, severity, confidence, evidence trail (clickable
source URLs + snippets), and the full reasoning trace — every web search, every
fetched page, every chain-of-thought step the agent took.

## 👥 Who is this for

**Legal & compliance teams.** Opposing counsel filed a brief drafted with AI.
You need to flag fabricated cases *before* you cite them back. Argus's evidence
trail is built to be filed as part of your response.

**AI governance teams (regulated industries).** Your analysts paste ChatGPT
outputs into board memos. You need a checkpoint between "the model said it" and
"we signed off on it." 92% of Fortune 500 require systematic factuality
verification; Argus is your audit gate.

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

The frontend streams every step **live** as it happens:

```
seq=  3  🔍 web_search       CitationVerifier  ⟶  "Smith 2021 widget resilience SSRN"
seq=  4  🌐 fetch_url_content CitationVerifier ⟶  https://api.crossref.org/works/...
seq=  5  💭 thinking          CitationVerifier ⟶  "Crossref returned 404. Checking arXiv..."
seq=  6  ✅ finding emitted    CitationVerifier ⟶  fabricated · major · 0.91 confidence
```

After verification, an **Adversarial Debate Protocol** (Attacker / Defender /
Judge — each round costs ~$0.001 on DeepSeek) stress-tests every high-stakes
finding. The debate transcript ships in the audit report. Reviewers see not
just the verdict, but the strongest case against the verdict — and why it lost.

## 🏗️ How it works

A LangGraph state machine fans 9 agents out over the document's claims:

```
                      ┌─────────────────────────────┐
                      │   📄 Ingest (PDF or text)     │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🧠 Planner → Atomizer        │
                      │  → typed atomic claims        │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🎯 CheckWorthiness gate      │
                      │  → drops trivial claims       │
                      └──────────────┬──────────────┘
                                     │  fan-out (per claim type)
            ┌──────────────┬─────────┼─────────┬──────────────┐
            ▼              ▼         ▼         ▼              ▼
       ┌────────┐   ┌──────────┐  ┌──────┐  ┌────────────┐  ┌────────────┐
       │Citation│   │ Citation │  │Data  │  │Consistency │  │ Evidence   │
       │Verifier│   │Alignment │  │Fresh.│  │  Checker   │  │  Hunter    │
       └───┬────┘   └────┬─────┘  └──┬───┘  └────┬───────┘  └────┬───────┘
           └─────────────┴──────┬────┴───────────┴───────────────┘
                                ▼
                      ┌─────────────────────────────┐
                      │  ⚔️ Challenger (debate)      │
                      │  Attacker / Defender / Judge  │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  📋 Reporter → audit report   │
                      │  → executive summary + PDF    │
                      └─────────────────────────────┘
```

Atomizer / CheckWorthiness / Challenger run on DeepSeek (cheap) so MiroMind
spend stays in the verifiers where it matters. Typical single-document audit
costs ~$3 in model calls — compared with ~$70 for the manual analyst review
it replaces.

### Engineering controls

- **`BoundedRunner`** — semaphore-bound concurrency per agent
- **`BudgetTracker`** — hard USD cap, aborts mid-flight before runaway spend
- **`retry_on_transient`** — exponential backoff for `429` / `5xx` from upstream
- **`make_idempotency_key`** — deterministic job-keyed idempotency
- **`json-repair`** — heuristic LLM JSON recovery

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
| **Models** | MiroMind `mirothinker-1-7-deepresearch` (verifiers) + DeepSeek (atomizer/challenger) |
| **Orchestration** | LangGraph 1.x StateGraph with parallel fan-out + reducer fan-in |
| **Backend** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + raw SSE |
| **Persistence** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **Reports** | Jinja2 + WeasyPrint (HTML→PDF) |
| **Live bus** | WebSocket · pluggable `TraceBus` (in-process / Redis pub/sub) |
| **Frontend** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |

## 🧪 Testing

```bash
uv run pytest -q          # 122 collected
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
