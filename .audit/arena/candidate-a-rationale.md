# Argus backend: target architecture (Fable candidate)

## Problem

Argus audits AI-written documents: extract claims, pause for a human to pick
which ones matter, deep-research each one on MiroMind, challenge the risky
verdicts, check cross-claim logic, score confidence deterministically, write a
summary, and show all of it live over a WebSocket. The current `src/argus`
does this through LangGraph with two checkpointers, six relational tables
that lose fields on the way in and out, an untyped dict event bus whose
sequence numbers restart on resume, a status enum with unused members and one
overloaded one, and an orchestrator that persists itself and writes a
`findings.json` side effect. Nine defects are verified in grounding.md; the
question is what the backend looks like written today for these requirements,
and how the Next.js app gets its types and consumes the stream.

## Usage (caller's view)

`sketch/USAGE.md` has the three call sites in full. The shape they impose:

```python
run = Run(job, llm, budget, cache, limits, emit)   # the CLI and the runner build this
await extract(run)          # queued -> extracting -> awaiting_review; job.claims = candidates
job.apply_review(claim_ids) # keeps the selection, records the rest on the review stage
await verify(run)           # awaiting_review -> verifying -> done; findings, traces, report on job
```

The runner wraps each phase in `_drive`: run it, translate an exception into
`job.fail(...)` or `INTERRUPTED`, save the document, publish the phase-end
event, close the channel. The WebSocket route is `async for ev in
events.subscribe(job_id, after=n): send(ev.model_dump_json())`. The web app
runs one reducer over the typed union and refetches the Job on phase-end kinds.

## Shape

**1. Pipeline. LangGraph goes.** Two plain coroutines over one Pydantic
document replace the graph, both checkpointers and the replay logic. The
graph bought three things: a node DAG (the pipeline is a straight line with
one fan-out, so `await` in order is the DAG), interrupt/resume (a persisted
`awaiting_review` status plus the credentials on the selection request is the
resume, and it survives restarts because the document is the state), and
reducers for parallel writes (fan-out tasks now return values and the phase
coroutine is the only writer of `run.job`, so no reducer is needed). What
LangGraph cost is defect 2 entirely plus the six-table checkpoint schema. In
`verify`, per-claim verifier tasks run under a semaphore and are merged as
they complete (`asyncio.as_completed`), so a budget abort at claim k keeps
claims 1..k-1 and the runner saves a FAILED job with truthful coverage. The
consistency check runs as a separate task concurrently with verification
because it only needs the claims; its redundancy filter runs at the merge
point after the verifier findings exist, so it fires. The skeptic returns new
`Finding` objects, replaced by id in the list; nothing is mutated in place.
`asyncio.TaskGroup` is deliberately not used for the outer structure so
`BudgetExceeded` propagates as itself, not inside an `ExceptionGroup`.

**2. Job lifecycle.** `JobStatus` = queued, extracting, awaiting_review,
verifying, done, failed, interrupted. Transitions are a table enforced by
`Job.transition`, `Job.fail` (any running status to FAILED with a reason) and
`Job.apply_review` (AWAITING_REVIEW only; status unchanged, `verify` does the
move). `interrupted` means exactly one thing: the process died or the task
was cancelled while running. Budget exhaustion is `failed` with a reason.
Startup `mark_interrupted()` loads each running job's document and moves it
through the state machine; `awaiting_review` is never touched. The runner
guards double-select with its `_runs` map (409) and capacity with
`max_active_jobs` (429). One `Budget` spans both phases: `verify` starts from
`spent_usd=job.cost_usd`.

**3. Persistence: the document is the row.** `jobs` has indexed summary
columns (status, owner, title, created_at, cost, counts, event_sequence) plus
a `document` JSON column holding `Job.model_dump(mode="json")`. `get` is
`Job.model_validate(row.document)`: nothing is lost, there is no assembler,
and the resume state is the same thing the API returns. `list` reads only the
summary columns. `verifier_cache` stays as its own table because it is
cross-job by definition. `users`, `user_api_keys` (Fernet), `share_links`,
`access_log`, `analytics_events` are unchanged in purpose. Alembic keeps one
migration generated from `store/tables.py`; the eight existing ones and the
tables they built are deleted. No data migration, per the owner's rule.

**4. Trace events.** `TraceEvent` is a Pydantic discriminated union on `kind`
with nine members: stage_started, stage_finished, claim_started, step,
heartbeat, finding, review_ready, run_finished, run_failed. Every event
carries `job_id`, `sequence`, `at`. `EventLog.publish` is synchronous:
sequence assignment, history append and fan-out to bounded subscriber queues
happen with no await between them, which under asyncio is atomic without a
lock. The counter is seeded from `job.event_sequence` when a phase opens the
channel, so numbering continues across the pause. A slow subscriber is
dropped (`SubscriberLagged`, WebSocket 1011) and reconnects with `?after=`;
`subscribe` registers its queue and snapshots history in the same synchronous
step, so replay plus live has no gap. History survives `close()` for a TTL so
a late client can still read the terminal event. Stages are described once,
by the pipeline, via `run.stage_started/stage_finished`; the `Stage` object
published is the one appended to `job.stages`, with `engine` taken from
`LLM.completion_engine`, so the summary cannot disagree with the document.

**5. LLM layer.** One facade, `LLM`, with `complete()` (structured output, no
tools; DeepSeek when configured else MiroMind) and `research()` (MiroMind deep
research streaming `Step`s through an `on_step` callback). One
`json_output.parse` with one repair round replaces two repair loops. `Usage`
carries `cost_usd` computed by `llm.cost`, so every pipeline call charges the
budget the same way, and the per-claim charge happens inside the claim task
so a breach surfaces immediately. `MiromindCredentials` is per run, validated
against `MIROMIND_ALLOWED_MODELS`, and never persisted. Tasks (`argus/tasks`)
own prompt (golden marker strings kept), output schema, `run(llm, ...)` and
pure converters; they never see the Job, the budget or events.

**6. API.** `AppState` is built in the lifespan and reached through one
`Depends(app_state)` typed on Starlette's `HTTPConnection`, so the same
dependency serves HTTP and WebSocket routes. One `POST /jobs` accepts a
multipart PDF or JSON text and produces a `Source`. `credentials` resolves
BYOK once (header key, then saved key id, then server key) and the selection
and rerun routes reuse it, which is why credentials are never on the Job.
`can_access` is one pure rule; `job_or_404` applies it and never leaks
existence. Uploads live at `{storage_root}/{job_id}/`, written by the route
and only read by the pipeline; no `findings.json`.

**7. Module map.** `domain/` (models, events) has no imports from the rest;
`llm/` imports domain; `tasks/` and `scoring/` import domain and llm;
`pipeline/` imports all of those plus the cache protocol-free class;
`events.py`, `store/`, `runner.py`, `api/`, `cli.py` sit on top. Organized by
what each module knows (a claim, an event, a price, a table), not by when it
runs. Deleted: `orchestrator/`, `agents/base.py`, `engineering.py`,
`trace_bus/`, `storage/` protocols, `db/assemblers`, `cache/`.

**8. Web types.** `argus export-schema` prints the JSON Schema of a wrapper
holding `Job`, `JobSummary`, `TraceEvent`; `json-schema-to-typescript` writes
`web/lib/api-types.ts`, committed and diff-checked in CI. The hand-mirrored
`web/lib/types.ts` is deleted; demo-only fields move to a local fixture type.
`useAuditRun` = `useReducer(applyTraceEvent)` with an exhaustive switch, a
resumable `subscribeTrace`, and a refetch of `GET /jobs/{id}` on phase-end
kinds. The 4 s status poll and the per-agent step heuristics go.

## Synthesis decision

<!-- filled in by the synthesizer; see arena verdict -->

## Tradeoffs accepted

- The `document` column is opaque to SQL. Anything the jobs list or an admin
  query needs must be a summary column; adding one is a code change plus a
  schema change. Accepted: the query surface today is `list by owner, newest
  first`.
- One process runs jobs. `max_active_jobs` and in-memory `EventLog` history
  assume it. A second API replica would need a shared event transport; that is
  a Fly scaling decision, not a design gap today.
- Dropping a lagging WebSocket client is stricter than buffering forever. The
  client-side resume makes it invisible; the server-side memory bound is worth
  it.
- Goldens must be regenerated deliberately at least twice in the delivery
  sequence (typed events; extract/verify entry). Each regeneration is its own
  reviewed commit.

## Alternatives considered

- **Keep LangGraph, fix the checkpointer.** Keeps two schemas for one state
  and the replay code paths. The graph's only non-trivial feature in use is
  interrupt/resume, which a persisted status implements in three lines.
  Rejected.
- **Keep relational tables for claims/findings/traces with a faithful
  assembler.** Fixes defect 1 by adding columns and tests forever. The data is
  only ever read as a whole document. Rejected.
- **Redis or Postgres LISTEN/NOTIFY for events.** Adds infrastructure for a
  single-process deployment. Rejected until there are two replicas.
- **Generate TS types from OpenAPI.** Loses the discriminated union of
  WebSocket events (not in OpenAPI paths). JSON Schema of an explicit wrapper
  covers both HTTP and WebSocket shapes in one artifact. Rejected.
- **Consistency after verification (sequential).** Simpler, but it puts one
  full LLM call on the critical path for no reason; it needs only the claims.
  Rejected.

## Open questions and risks

- `cryptography` (Fernet) must be a declared dependency for saved keys; check
  pyproject before the accounts store lands.
- `trace_history_max_events` truncation: a client past the truncation point
  after a very long run gets a shorter replay; it refetches the Job on the
  terminal event, which is the source of truth. Acceptable, but document it.
- The golden bucket keys change (`kind` + `stage.key` + `claim_id`/`agent`);
  the harness rewrite in commit 1 must be reviewed as a semantic change, not a
  mechanical one.
- MiroMind `starting_after` resume semantics are assumed per the current
  client; verify against the live API before deleting the old stream code.

## Next implementation step

Commit 1 below: land `domain/models.py` (`JobStatus` + transitions),
`domain/events.py`, `events.py` (`EventLog`), wire them under the existing
LangGraph nodes and the WebSocket route, rewrite the golden harness buckets,
regenerate goldens, ship the reducer and generated types in the web app.

## Defects fixed by construction

| # | Defect | Removed by |
|---|--------|-----------|
| 1 | Lossy six-table persistence | Part 3: the Job document is the row; `get` is `model_validate`. |
| 2 | LangGraph replay fights | Part 1: no graph, no checkpointer; resume = load document + credentials. |
| 3 | Stage summaries computed twice, wrong engines | Part 4: `run.stage_finished(stage)` publishes the object appended to `job.stages`; engine from `LLM.completion_engine`. |
| 4 | `interrupted` overloaded, unused statuses | Part 2: seven statuses, transition table, `fail` vs `INTERRUPTED` split, `mark_interrupted` via the state machine. |
| 5 | Sequence restarts on resume; non-atomic publish | Part 4: synchronous `publish`, counter seeded from `job.event_sequence`. |
| 6 | Skeptic mutates during parallel consistency; filter never fires | Part 1: skeptic returns new Findings replaced by id; `drop_redundant` runs at the merge point after verifier findings exist. |
| 7 | Untyped dict events; web synthesizes stages | Parts 4 and 8: discriminated union, generated TS types, reducer records `stage_started/finished`. |
| 8 | Duplication (submit x3, two JSON loops, app.state reach-in, repo-None branches) | Parts 5 and 6: one `POST /jobs`, one `json_output.parse`, one `app_state` dependency, `Run.cache: VerifierCache | None` as the only optional. |
| 9 | `findings.json` side effect; orchestrator persists itself | Parts 1 and 6: pipeline writes nothing; the runner saves at phase end; CLI writes only to `--out`. |

## Delivery sequence

Each commit keeps `tests/test_golden_pipeline.py` green or regenerates the
goldens in the same commit with the diff reviewed. Riskiest first.

1. **Typed events and state machine under the existing pipeline** (defects
   4, 5, 7). Add `domain/models.JobStatus` transitions, `domain/events.py`,
   `events.EventLog`; make the LangGraph nodes publish typed events through
   the new log; rewrite the golden bucket function for `kind`/`stage.key`;
   regenerate goldens. Web: generated `api-types.ts`, reducer, hook; delete
   `types.ts` and the poll. Verifiable: goldens, `tsc`, a browser run.
2. **`extract`/`verify` replace the graph** (2, 3, 6). Add `pipeline/`,
   `tasks/`, `scoring/`; rewrite `runner.py`; delete `orchestrator/`,
   LangGraph and both checkpointer packages. Harness entry becomes the two
   coroutines. Goldens regenerated once more (stage engines now correct).
3. **Document store** (1). `store/tables.py`, `store/jobs.py`,
   `verifier_cache.py`, single Alembic migration; delete `db/assemblers`,
   `db/repository`, `storage/`. Verifiable: round-trip property test
   `save(job); get(id) == job` over the golden Job.
4. **API surface** (8, 9). Single `POST /jobs` with `Source`, `AppState`
   dependency, `credentials`, `can_access`; remove `findings.json`, `auto_review`,
   `input_mode/pdf_path/input_text`. Verifiable: route tests with the fake LLM.
5. **LLM layer** (8). `llm/` facade, one `json_output.parse`, `Usage.cost_usd`,
   `cost.py`; delete `models/miromind.py`, `agents/base.py`. Goldens unchanged
   (`llm_calls` counts are per marker).
6. **Cleanup.** Delete `engineering.py`, `trace_bus/`; add `argus
   export-schema` to CI with the diff check.
