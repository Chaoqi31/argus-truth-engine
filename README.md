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

This branch contains:
- **Plan A** — Python CLI (`uv run argus audit ...`) running Planner + Citation
  Verifier end-to-end against the real MiroMind API, writing `findings.json`.
- **Plan C** — Next.js frontend in [`web/`](web/) that loads `findings.json`
  and renders the PDF + Reasoning Panel + Trace replayer.

## Quickstart — CLI

Prerequisites: Python 3.12, [uv](https://docs.astral.sh/uv/), and a MiroMind
API key from <https://platform.miromind.ai/>.

```bash
uv sync
export ARGUS_MIROMIND_API_KEY=sk_…
uv run argus audit examples/sample-report.pdf -o findings.json --budget-usd 5
```

`--budget-usd` caps per-job MiroMind spend. The default is $5 — enough for the
bundled 4-page sample with the flagship model at promo pricing. Jobs that
breach the cap are aborted gracefully and write a partial `findings.json` with
`status: "failed"`.

The resulting `findings.json` contains:

- `claims[]` — every factual claim the Planner extracted from the PDF
- `findings[]` — every verdict the Citation Verifier produced
- `traces[]` — the complete reasoning chain for each agent call,
  including every `thinking`, `web_search`, `fetch_url_content`, and
  `execute_python` step MiroMind emitted
- `evidences[]` — clickable external URLs that support each verdict

## Persistence (optional)

Pass `--db-url` to persist the completed Job to a SQL database in addition
to `findings.json`. For local development:

```bash
docker compose up -d postgres
uv run alembic -c alembic.ini upgrade head
uv run argus audit examples/sample-report.pdf \
  --db-url postgresql+asyncpg://argus:argus@localhost:5436/argus
```

The schema covers all six entities (`jobs`, `claims`, `findings`, `traces`,
`steps`, `evidences`). Migrations are managed by Alembic; the same schema
works against SQLite (tests) and Postgres (production).

## Quickstart — Web (Plan C)

```bash
cd web
pnpm install
pnpm dev          # http://localhost:3000
```

Click "Try the sample audit" to load the bundled demo job, or drop a
`findings.json` produced by the CLI above.

See [`web/README.md`](web/README.md) for details.

## Stack

- Backend: Python 3.12, Pydantic v2, httpx + raw SSE, pdfplumber, Typer
- Frontend: Next.js 16, React 19, TypeScript 5, Tailwind v4, Zustand, react-pdf, @xyflow/react
- Model: MiroMind `mirothinker-1-7-deepresearch` (Responses API)
- Future plans: LangGraph + 5-agent backend (Plan B), evaluation dataset + deployment (Plan D)

## Development

```bash
uv sync --all-groups          # install runtime + dev deps
uv run pytest -q              # run the test suite
uv run mypy src/argus         # type check
uv run ruff check .           # lint
```

## License

MIT
