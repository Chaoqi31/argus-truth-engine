# Argus Web

The Next.js frontend for Argus. Reads a `findings.json` produced by the Plan A
CLI, renders the PDF with claim-highlight chips on the left and a Reasoning
Panel (Findings / Evidence / DAG tabs) on the right. The "Trace stream" tab
replays the recorded reasoning steps with a configurable interval — same UX
as a live SSE stream, deterministic for demos.

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

## Stack

- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript 5
- Tailwind CSS v4
- Zustand (state)
- react-pdf (pdf.js)
- @xyflow/react (DAG)
- Vitest + @testing-library/react (tests)
