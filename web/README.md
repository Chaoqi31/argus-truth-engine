# Argus Web

The Next.js frontend for Argus. Reads a `findings.json` produced by the Plan A
CLI, renders the PDF with claim-highlight chips on the left and a Reasoning
Panel (Findings / Evidence / DAG tabs) on the right. The "Trace stream" tab
replays the recorded reasoning steps with a configurable interval — same UX
as a live SSE stream, deterministic for demos.

## Connecting to the Argus API

The web app talks to the Argus HTTP+WebSocket API (default `http://localhost:8080`).

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `ARGUS_API_HOST` | server-side (Next.js) | `http://localhost:8080` | Origin Next.js proxies `/api/argus/*` to. Set in `.env.local`. |
| `NEXT_PUBLIC_ARGUS_WS_HOST` | client-side (browser) | `${window.location.hostname}:8080` | Host the browser opens the trace WebSocket against. |

Run both processes in two terminals:

```bash
# terminal 1 — Argus API
uv run argus serve --host 127.0.0.1 --port 8080

# terminal 2 — web
cd web && pnpm dev
```

Open <http://localhost:3000>.

## Quickstart

```bash
cd web
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # vitest
pnpm build        # production build
```

Click "Try the sample audit" on the landing page to load the bundled demo.

## Custom audits

To audit a custom report, run the Python CLI from the repo root:

```bash
uv run argus audit your-report.pdf -o findings.json
```

then drop `findings.json` via the landing-page picker.

## Live audit flow

1. Start the API: `uv run argus serve --host 127.0.0.1 --port 8080`
2. Start the web app: `cd web && pnpm dev`
3. Open <http://localhost:3000>
4. Click **Upload a PDF** and pick a research-report PDF
5. The audit page opens at `/audit?id=<jobId>` and streams steps + findings live over WebSocket
6. When the audit finishes, the full Job (evidences, audit report, ranked findings) loads via `GET /jobs/{id}`

If you only want to demo the UI without burning credits, click **"…or try the sample audit"** — it loads the bundled `public/sample-findings.json`.

### Refresh mid-audit

The WebSocket connection passes `?after=<lastSeq>` on reconnect, so refreshing the page mid-run rebuilds the streamed state from the in-process history buffer.

### Multi-instance deploys

Set `ARGUS_REDIS_URL` on the API process to swap the InProcessBus for the Redis-backed pubsub bus — multiple API replicas will then share the same job stream.

## Stack

- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript 5
- Tailwind CSS v4
- Zustand (state)
- react-pdf (pdf.js)
- @xyflow/react (DAG)
- Vitest + @testing-library/react (tests)
