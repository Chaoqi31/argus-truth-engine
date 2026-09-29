# Argus architecture refactor plan

Branch `worktree-architecture-refactor`, worktree
`.claude/worktrees/architecture-refactor` of `~/Dev/argus-truth-engine`.
Decision trail: `.audit/architecture-refactor.tsv` (append-only).

## Definition of done

The refactor is done when every item below holds on the branch head:

1. Backend: `uv run pytest -q`, `uv run ruff check .`, `uv run mypy src/argus` all pass.
2. Frontend: `vitest run`, `tsc --noEmit`, `eslint .` all pass, and CI runs all three.
3. The golden pipeline harness (Phase 0) replays the scripted audit and the
   resulting Job and event stream match the approved snapshot.
4. A live-shaped run works end to end on the real product surface: API server +
   web UI, submit text, review claims, get findings (scripted LLM fake server).
5. Every item in "Target architecture" below is either done or has a logged
   reason it was dropped.

## Baseline (2026-09-30, commit 2eeaf3b)

- Backend: 199 passed, 1 skipped (Redis). `test_reporting_pdf.py` and
  `test_api_pdf_report.py` cannot import locally (WeasyPrint needs pango).
  ruff clean, mypy strict clean, type parity OK.
- Frontend: 36 files / 171 tests pass. `tsc --noEmit` has 3 errors in test
  files. eslint has 1 error (`react-hooks/set-state-in-effect`). CI only runs
  vitest, so neither is caught.
- Size: backend src 10.1k lines, backend tests 6.7k, web 19.9k (incl. tests).

## Findings that drive the design

- Persistence is lossy. `FindingRow` has no `reasoning_chain` or `flags`,
  `ClaimRow` has no `parent_claim_id`. A job reloaded from the DB loses its
  reasoning chain, the headline transparency feature. Root cause: a
  hand-written 6-table mapping of an aggregate that is only ever loaded and
  saved whole.
- LangGraph is used for a fixed linear pipeline with one parallel pair and one
  pause. The code works around its replay semantics (`is_resuming`, the
  `finish_stage` guard, `__interrupt__` detection, `aborted` checks in every
  node, two graphs on one thread id). Crash resume re-runs Phase B anyway.
- Stage summaries are computed twice: each node publishes one, then
  `_build_stages` recomputes them post hoc with duplicated strings. The engine
  label is wrong in `_build_stages` when MiroMind runs the planner.
- Job status `interrupted` means both "paused for human review" and "worker
  crashed". The history page shows jobs awaiting review as failed.
- The live trace protocol is untyped dicts on both sides. The frontend
  synthesizes stage markers from five event kinds even though `stage` events
  already carry them, and turns trace-summary `step` payloads into fake steps.
- Dead features and code: server PDF report (no UI caller for
  `/report.pdf`; pulls WeasyPrint, pango, jinja2, markdown), `/jobs/{id}/resume`
  (no UI caller), Redis trace bus (no deployment sets it, in-process runner
  makes multi-instance incoherent), `_make_finding`, `ReasoningStep`,
  `BudgetTracker.acharge`, `ParsedDoc.page_for_offset`, `SKEPTIC_VERSION`,
  four verdicts no prompt emits, `Job.status` values never set,
  `auto_review` (the UI always sends false), `output_path` side-writes,
  `web/lib/api.ts#downloadReport`.
- Duplication: `audit_pdf`/`audit_text`, `JobRunner.submit`/`submit_text`/
  `resume`, JSON extraction and repair in two LLM clients, `responseMessage`
  and `downloadText` in the web app, stage blurbs and ledgers in two web files.
- Frontend types are hand-mirrored from `domain.py`, guarded by a regex script
  that checks field names only.

## Target architecture

Backend (`src/argus`):

- `domain.py`: Pydantic domain types. `JobStatus` is a real state machine:
  queued, running, awaiting_review, done, failed, interrupted.
- A plain async pipeline replaces LangGraph. Phase A (parse, plan, atomize,
  filter, gate) returns the claims for review. Phase B (verify, then skeptic
  and consistency in parallel, confidence, report) returns findings. Budget
  breach is an exception, not an `aborted` flag threaded through state. Each
  stage produces its `Stage` record once; the event and `job.stages` share it.
- The pipeline takes injected ports (LLM clients, cache, event sink) and knows
  nothing about the DB, HTTP, or files.
- The job store keeps one `jobs` row per audit: indexed metadata columns plus
  one JSON payload of the Pydantic aggregate. One squashed migration.
- Typed trace events: one Pydantic discriminated union, the only producer of
  WebSocket payloads.
- The API is thin: FastAPI dependencies, one job runner created at startup,
  one submit path for PDF and text.
- MiroMind transport owns retry and rate limiting. Cost and budget live
  together.

Frontend (`web`):

- Types generated from the backend JSON Schema, replacing the hand mirror and
  the parity script.
- One API client module; the live trace hook consumes typed events only.
- One home for verdict and stage vocabulary.

## Phases

0. Harness. Golden pipeline snapshot (Job + event stream) from a scripted LLM,
   a persistence round-trip test that fails on the current code, an API
   flow test (submit text, review, select, done).
1. Subtract. Delete the dead features and code listed above, one unit each,
   tests green after each.
2. Design. Run the architect skill (arena) for the pipeline, store, events,
   and runner shapes. Synthesize one sketch.
3. Store as a document (fixes the data loss). Squash migrations.
4. Pipeline without LangGraph against the sketch. Golden snapshot holds.
5. Typed events, backend then frontend.
6. API layer: dependencies, single submit path, status state machine.
7. Frontend: generated types, one API client, shared vocabulary, fix tsc and
   eslint, add both to CI.
8. Docs and ops: README architecture, self-host docs, `.env.example`, compose
   files, Dockerfile.
9. Verify the whole against the definition of done on the real surface.
   Cross-model review of the trail. Hand back.

## Status

Phase 0 in progress.
