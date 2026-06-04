# Argus Web

The Next.js frontend for Argus. It renders the audit cockpit: source document
on the left, ranked findings in the center, and an Evidence / Trace console on
the right. The bundled demo replays a recorded audit with the same live trace
surface used by real jobs, but without calling the MiroMind API.

## Connecting to the Argus API

The web app talks to the Argus HTTP+WebSocket API (default `http://127.0.0.1:8080`).

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `ARGUS_API_HOST` | server-side (Next.js) | `http://127.0.0.1:8080` | Origin Next.js proxies `/api/argus/*` to. Set in `.env.local`. |
| `NEXT_PUBLIC_ARGUS_WS_HOST` | client-side (browser) | `${window.location.hostname}:8080` | Host the browser opens the trace WebSocket against. |

Run both processes in two terminals:

```bash
# terminal 1 — Argus API
uv run argus serve --host 127.0.0.1 --port 8080

# terminal 2 — web
cd web && pnpm dev
```

Open <http://127.0.0.1:3000>.

## Quickstart

```bash
cd web
pnpm install
pnpm dev          # http://127.0.0.1:3000
pnpm test         # vitest
pnpm build        # production build
```

Click "See a sample audit" on the landing page to load the bundled demo.

## Custom audits

To audit a custom report, run the Python CLI from the repo root:

```bash
uv run argus audit your-report.pdf -o findings.json
```

then drop `findings.json` via the landing-page picker.

## Live audit flow

1. Start the API: `uv run argus serve --host 127.0.0.1 --port 8080`
2. Start the web app: `cd web && pnpm dev`
3. Open <http://127.0.0.1:3000>
4. Paste a MiroMind API key, then paste text or upload a PDF
5. The audit page opens at `/audit?id=<jobId>` and streams steps + findings live over WebSocket
6. When the audit finishes, the full Job (evidences, audit report, ranked findings) loads via `GET /jobs/{id}`

If you only want to demo the UI without burning credits, click **"See a sample audit"** — it replays the bundled `public/sample-findings.json`.

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
