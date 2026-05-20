# Argus

Audit tool for buy-side investment analysts. Upload a research report PDF; Argus
surfaces fabricated citations, misaligned quotes, stale data points, and internal
contradictions, and shows the full reasoning chain — every search, every fetched
page, every Python check — behind each verdict.

Built on MiroMind's `mirothinker-1-7-deepresearch` model via the Responses API,
with a five-agent orchestration: Planner, Citation Verifier, Citation Alignment,
Data Freshness, Consistency Checker, and Reporter.

## Status

Early development. Submitting to the UCWS Singapore 2026 × MiroMind Deep
Research track.

This branch contains the **Plan A vertical slice**: a CLI that runs the
Planner Agent + Citation Verifier Agent end-to-end against the real
MiroMind API and writes a `findings.json` with the full reasoning trace.

## Quickstart

Prerequisites: Python 3.12, [uv](https://docs.astral.sh/uv/), and a MiroMind
API key from <https://platform.miromind.ai/>.

```bash
uv sync
export ARGUS_MIROMIND_API_KEY=sk_…
uv run argus audit examples/sample-report.pdf -o findings.json
```

The resulting `findings.json` contains:

- `claims[]` — every factual claim the Planner extracted from the PDF
- `findings[]` — every verdict the Citation Verifier produced
- `traces[]` — the complete reasoning chain for each agent call,
  including every `thinking`, `web_search`, `fetch_url_content`, and
  `execute_python` step MiroMind emitted
- `evidences[]` — clickable external URLs that support each verdict

## Stack

- Backend: Python 3.12, Pydantic v2, httpx + raw SSE, pdfplumber, Typer
- Model: MiroMind `mirothinker-1-7-deepresearch` (Responses API)
- Future plans: LangGraph (Plan B), Next.js / React frontend (Plan C),
  evaluation dataset + deployment (Plan D)

## Development

```bash
uv sync --all-groups          # install runtime + dev deps
uv run pytest -q              # run the test suite
uv run mypy src/argus         # type check
uv run ruff check .           # lint
```

## License

MIT
