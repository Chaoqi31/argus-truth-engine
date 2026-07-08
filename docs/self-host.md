# Self-host Argus locally

The public Vercel site is a demo. For real audits, run Argus locally and use
your own API keys.

## Requirements

- Docker Desktop or Docker Engine with Docker Compose
- A MiroMind API key
- Optional but recommended: a DeepSeek or OpenAI-compatible key for cheaper
  claim extraction and reporting

## Start

```bash
git clone <repo-url>
cd MiroMind-Deep-Research

cp .env.example .env
# Edit .env:
#   ARGUS_MIROMIND_API_KEY=...   # optional if you prefer pasting a key per run
#   ARGUS_MIROMIND_MODEL=mirothinker-1-7-deepresearch-mini
#   ARGUS_CHEAP_LLM_API_KEY=...   # recommended

docker compose -f docker-compose.selfhost.yml up --build
```

Open http://localhost:3000.

In self-hosted mode, `/` opens the audit workspace directly instead of the
marketing/demo homepage. The backend API is available at http://localhost:8080.
Open http://localhost:3000/app to browse or delete previous local runs.

## Data

- Postgres data is stored in the `argus_pgdata` Docker volume.
- Uploaded PDFs and text inputs are stored in the `argus_uploads` Docker volume.
- Audit history survives container restarts and normal `docker compose down`.
  It is removed only when you run `docker compose -f docker-compose.selfhost.yml down -v`.
- API keys are supplied by your `.env` file or pasted into the browser for a run.
  When `ARGUS_MIROMIND_API_KEY` is set in `.env`, the self-hosted UI can submit
  without asking you to paste the same key again.
- The audit page can switch between `mirothinker-1-7-deepresearch-mini` and
  `mirothinker-1-7-deepresearch` before each run.

## Stop

```bash
docker compose -f docker-compose.selfhost.yml down
```

Delete local data:

```bash
docker compose -f docker-compose.selfhost.yml down -v
```

## Developer fallback

If you want to run from source instead of full Docker:

```bash
docker compose up -d postgres
uv sync
uv run alembic upgrade head
uv run argus serve --host 127.0.0.1 --port 8080

cd web
pnpm install
pnpm dev
```
