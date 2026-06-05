# Argus Submission Fields

## Project Name
Argus

## Tagline
The audit layer for AI-generated content.

## Description
Argus is a truth engine for AI-generated reports, legal briefs, and governance documents. Instead of returning a black-box score, Argus extracts factual claims, lets reviewers choose what to verify, and runs selected claims through autonomous deep research.

Each finding includes a verdict, severity, confidence, the corrected answer, cited evidence, and a readable reasoning trace that shows searches, fetched sources, tool calls, and judgment nodes. The sample legal audit catches fabricated cases, reversed holdings, and unsupported inferences in an AI-drafted brief, then packages the result into an exportable audit pack for handoff.

Technically, Argus uses a LangGraph pipeline with deterministic parsing and gating, DeepSeek for planning and report writing, and MiroMind for the web-heavy verifier and skeptic passes. The product is built for legal, compliance, AI governance, and research teams that must trust AI output they did not produce before signing off.

## Demo URL
https://argus-truth-engine.vercel.app

## Repo URL
https://github.com/Chaoqi31/argus-truth-engine

## Track
DeepResearch, Application

## Tech Stack
Next.js 16, React 19, TypeScript, Tailwind CSS, Python 3.12, FastAPI, LangGraph, MiroMind API, DeepSeek, SQLite/Postgres checkpointers, WebSocket/SSE, Vercel

## Project Screenshots
assets/01-landing-page.png
assets/02-audit-cockpit.png
assets/03-full-reasoning-trace.png

## Project Logo
assets/argus-logo-512.png

## Demo File Link
TBD after the demo video is uploaded.

## LinkedIn URL
Fill in your personal LinkedIn URL if you want to include it.

## Team Members
Fill in the final team member names and emails in the submission form.

## Notes For Optional Award Positioning
Best Use Case: Argus targets legal, compliance, governance, and research teams that need to verify AI output they did not produce.

Best Technical Implementation: LangGraph 10-stage pipeline, per-claim MiroMind deep research, skeptic pass, resumable traces, exportable audit/evidence packs.

Best Reasoning Transparency: Every finding exposes cited evidence plus a full readable trace of searches, fetched sources, reasoning steps, and judgment nodes.
