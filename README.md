<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# 🛡️ Argus

### **Audit AI-generated investment research before you trade on it.**

*Catch fabricated citations, misaligned quotes, stale data, and self-contradictions — with the full reasoning chain laid bare.*

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-purple)](https://github.com/langchain-ai/langgraph)
[![Tests](https://img.shields.io/badge/tests-120_passing-success)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## 🧭 The problem

Buy-side analysts read dozens of equity-research reports a week. Sell-side notes, third-party
white papers, and an exploding population of **AI-generated** research all blend together —
and AI authors hallucinate. They cite papers that don't exist. They paraphrase sources into
the opposite of what was said. They quote GDP numbers superseded two quarters ago. They
contradict themselves on page 12 of what page 3 promised.

**A single bad citation can move billions.** And manually verifying every claim in every
report is not a job a human should do.

## 🎯 What Argus does

You give it a PDF. It gives you back **every factual claim**, **every verdict on that
claim**, and **every step of reasoning** that produced the verdict.

| Issue type | What it catches | How it verifies |
|---|---|---|
| 🪤 **Fabricated citations** | References that don't exist | Crossref / arXiv / SSRN cross-checks |
| 🪞 **Misaligned quotes** | Paraphrase ≠ source | Fetches the cited URL, paragraph-by-paragraph compare |
| 📉 **Stale data** | Numbers superseded by newer data | FRED / World Bank / SEC EDGAR / IMF |
| 🧩 **Internal contradictions** | Report self-contradicts | Pairwise claim consistency check |

Every finding ships with:

- **Verdict** (`fabricated` / `mismatch` / `stale` / `contradiction` / `ok` / `uncertain`)
- **Severity** (`critical` / `major` / `minor`)
- **Confidence** 0–1
- **One-line summary**
- **Evidence trail** — clickable source URLs + snippets
- **Full reasoning trace** — every web search, fetched page, Python check, and chain-of-thought

## ✨ The killer feature: **Reasoning transparency**

> *"You used to either trust a research report or not. Argus shows you,
> claim by claim, how an AI verified every sentence — and which sentences it caught lying."*

Reasoning isn't a black box. The frontend streams every step **live** as it happens:

```
seq=  3  🔍 web_search       CitationVerifier  ⟶  "Smith 2021 widget resilience SSRN"
seq=  4  🌐 fetch_url_content CitationVerifier ⟶  https://api.crossref.org/works/...
seq=  5  💭 thinking          CitationVerifier ⟶  "Crossref returned 404. Checking arXiv..."
seq=  6  ✅ finding emitted    CitationVerifier ⟶  fabricated · major · 0.91 confidence
```

Watch each agent think. See every source. **Inspect every decision.**

## 🏗️ How it works

A LangGraph state machine fans 5 agents out over the PDF's claims:

```
                      ┌─────────────────────────────┐
                      │   📄 PDF parsing (pdfplumber) │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🧠 Planner Agent              │
                      │  → extracts typed claims      │
                      └──────────────┬──────────────┘
                                     │  fan-out
            ┌──────────────┬─────────┼─────────┬──────────────┐
            ▼              ▼         ▼         ▼              ▼
       ┌────────┐    ┌──────────┐  ┌──────┐  ┌──────────────┐
       │Citation│    │ Citation │  │Data  │  │ Consistency  │
       │Verifier│    │Alignment │  │Fresh.│  │   Checker    │
       └───┬────┘    └────┬─────┘  └──┬───┘  └──────┬───────┘
           └──────────────┴────┬──────┴─────────────┘
                               │  fan-in (LangGraph reducers)
                               ▼
                      ┌─────────────────────────────┐
                      │  📋 Reporter Agent             │
                      │  → executive summary (MD)     │
                      └─────────────────────────────┘
```

Each specialist runs in parallel, each handles its own subset of claim types, and a state
reducer merges their findings without race conditions.

### Engineering controls

- **`BoundedRunner`** — semaphore-bound concurrency per agent
- **`BudgetTracker`** — hard USD cap, aborts mid-flight before runaway spend
- **`retry_on_transient`** — exponential backoff for `429` / `5xx` from upstream
- **`make_idempotency_key`** — deterministic job-keyed idempotency, ready for event-store dedup
- **`json-repair`** — heuristic LLM JSON recovery (missing commas, unescaped strings)

### Storage layer

```
domain.Pydantic ←─ 1:1 round-trip ─→ SQLAlchemy 2.0 async ORM
                                          │
                  ┌──── aiosqlite (tests, demo) ────┐
                  │                                  │
                  └──── asyncpg + Postgres (prod) ───┘

Alembic migrations cover both backends from the same revision history.
```

### Live trace bus

```
audit_pdf() ──publish──→  TraceBus protocol
                              ├── InProcessBus (asyncio.Queue, single instance)
                              └── RedisPubSubBus (pub/sub, multi-instance safe)
                                         │
                                         ▼
                              WebSocket /ws/jobs/{id}/trace
                              ├── history replay (?after=<seq>)
                              └── live stream until terminal event
```

## 🚀 Quickstart

### Option A — Web UI (recommended)

```bash
# 1. Backend
cp .env.example .env       # fill in ARGUS_MIROMIND_API_KEY
uv sync
uv run argus serve --host 127.0.0.1 --port 8080

# 2. Frontend (new terminal)
cd web && pnpm install && pnpm dev

# 3. Open http://localhost:3000
#    Click "Upload a PDF" → watch the live audit stream.
```

> 💡 Don't want to burn MiroMind credits? Click **"…or try the sample audit"** to load the
> bundled demo with 6 findings across all four issue categories.

### Option B — CLI

```bash
uv sync
export ARGUS_MIROMIND_API_KEY=sk_…

uv run argus audit examples/sample-report.pdf \
  -o findings.json \
  --budget-usd 50
```

The CLI runs the same 5-agent pipeline as the server. Use `--db-url` to persist:

```bash
docker compose up -d postgres
uv run alembic -c alembic.ini upgrade head
uv run argus audit your-report.pdf \
  --db-url postgresql+asyncpg://argus:argus@localhost:5436/argus
```

### Option C — HTTP API

```bash
uv run argus serve --host 0.0.0.0 --port 8080
```

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/healthz` | health probe |
| `POST` | `/jobs` | upload PDF (multipart `pdf=…`) → `{job_id}` 202 |
| `GET`  | `/jobs/{job_id}` | poll status or fetch final Job JSON |
| `WS`   | `/ws/jobs/{job_id}/trace` | history replay + live event stream |

Curl example:

```bash
JOB=$(curl -s -X POST http://127.0.0.1:8080/jobs \
  -F "pdf=@your-report.pdf;type=application/pdf" | jq -r .job_id)

# Stream live events
wscat -c "ws://127.0.0.1:8080/ws/jobs/${JOB}/trace?after=0"
```

## 🧰 Stack

| Layer | Choice |
|---|---|
| **Model** | MiroMind `mirothinker-1-7-deepresearch` via Responses API |
| **Orchestration** | LangGraph 1.x StateGraph with parallel fan-out + reducer fan-in |
| **Backend** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + raw SSE |
| **Persistence** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **Live bus** | WebSocket · pluggable `TraceBus` (in-process / Redis pub/sub) |
| **PDF** | pdfplumber + pymupdf |
| **Frontend** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |
| **CLI** | Typer · structlog |
| **Tests** | pytest-asyncio · respx · vitest · @testing-library/react |

## 🧪 Testing

```bash
# Backend
uv run pytest -q          # 88 collected (1 skipped if no Redis)
uv run mypy src/argus     # strict type-check
uv run ruff check .       # lint

# Frontend
cd web && pnpm test       # vitest, 32 passing
```

Coverage: **91%** on core modules.

### Pre-push gate

To run the full gate (lint + types + backend tests + frontend tests) before every
push, opt this clone in once:

```bash
git config core.hooksPath .githooks
```

The hook ([`.githooks/pre-push`](.githooks/pre-push)) runs everything through `uv` and
`pnpm` so it picks up the project's managed environments rather than whatever
`pytest`/`pnpm` happen to be on global PATH.

The orchestrator is exercised end-to-end against a deterministic `StreamRouter` mock that
replays canned MiroMind SSE events, so the full 5-agent fan-out is tested without burning
live credits.

## 🎬 Demo

> Demo video — coming soon. Until then, run `pnpm dev` and click "Try the sample audit."

## 🤝 Contributing

This project is a UCWS Singapore 2026 × MiroMind Deep Research hackathon submission.
Issues and PRs welcome after the submission window closes.

## 📜 License

[MIT](LICENSE)

## 🙏 Acknowledgements

- **[MiroMind](https://platform.miromind.ai/)** for the `mirothinker-1-7-deepresearch`
  model and the Responses API
- **[UCWS Singapore](https://www.ucws.sg/)** for hosting the hackathon
- **[LangGraph](https://github.com/langchain-ai/langgraph)** for the agent orchestration
  primitives
- **[json-repair](https://github.com/mangiucugna/json_repair)** for saving us from
  malformed LLM outputs more than once
