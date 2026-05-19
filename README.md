# Argus

Audit tool for buy-side investment analysts. Upload a research report PDF; Argus
surfaces fabricated citations, misaligned quotes, stale data points, and internal
contradictions, and shows the full reasoning chain — every search, every fetched
page, every Python check — behind each verdict.

Built on MiroMind's `mirothinker-1-7-deepresearch` model via the Responses API,
with a five-agent LangGraph orchestration: Planner, Citation Verifier, Citation
Alignment, Data Freshness, Consistency Checker, and Reporter.

## Status

Early development. Submitting to the UCWS Singapore 2026 × MiroMind Deep Research
track.

## Stack

- Backend: Python, FastAPI, LangGraph
- Frontend: Next.js, React, TypeScript
- Model: MiroMind `mirothinker-1-7-deepresearch` (Responses API)
- Storage: Postgres, Redis, object storage

## License

MIT
