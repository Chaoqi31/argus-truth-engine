# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this project is

**Argus** — an audit tool for AI-generated content. The user uploads a PDF (or pastes text); the system extracts every factual claim, verifies each one via deep research, and returns a finding + verdict + reasoning chain + clickable evidence for each. The pitch: "Patronus/Galileo/Vectara help you ship AI you can trust; Argus helps you trust AI someone else shipped to you."

**Target user**: compliance officers, legal teams, AI governance teams, buy-side analysts — people who *consume* AI output but didn't produce it.

---

## Hackathon context (read before any submission-shaping change)

**Event**: UCWS Singapore 2026 × MiroMind, Deep Research Track.
**Prizes**: three non-ranked USD 3,000 awards. Argus competes for all three:

| Award | What judges look for | Argus' angle |
|-------|---------------------|--------------|
| **Best Use Case** | Real, valuable problem | Investment research + compliance personas; finding-level money-saving framing |
| **Best Technical Implementation** | Depth in API usage, reasoning chains, agent workflows | LangGraph 2-phase pipeline with parallel fan-out, MiroMind Responses API with `background=true` + resumable streams, hybrid checkpointer, engineering controls: hard budget cap, global rate limit, idempotency keys, resumable SSE streams |
| **Best Reasoning Transparency** | "How does the AI think?" visibility | Live trace stream of MiroMind's native `thinking`/`web_search`/`fetch_url_content`/`execute_python` events; a clickable per-stage pipeline trace where every stage shows its real output; every verdict links to external evidence |

**Submission deliverables**: GitHub repo · ≤200-word intro · ≤3-min demo video · live Vercel URL · README with architecture + reproducible local-demo instructions.

**Scoring-decisive moment** (from hackathon brief): the **1:30–2:30** "Reasoning Walkthrough" segment in the demo video. When changing UI affordances around the pipeline step trace / evidence panel, treat them as competition-critical surface.

**Out of scope for hackathon** (do not add): auth/multi-tenancy, persistent history UI, custom MCP server, mobile-responsive design, non-English, scanned-PDF OCR, real-time collaboration. Adding any of these dilutes scoring without moving the awards.

