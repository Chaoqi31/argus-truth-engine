# Argus backend: target architecture (Opus candidate)

## Problem

Argus runs a fixed audit pipeline with one human pause that can last days and must
survive deploys. It streams progress live and stores a result that must match the
stream. Today three representations of one audit drift apart: LangGraph state and
checkpoints, hand-built trace-bus dicts, and a six-table mapping. The nine defects are
that drift. Constraints: goldens pin the final Job and the grouped event stream; one
process runs jobs; SQLite for dev, Postgres in deployments; no compatibility layers or
data migrations; the web changes in the same branch; BYOK keys are never stored.

## Usage (caller's view)

Written first in `sketch/USAGE.md`: CLI, runner, WebSocket route, golden harness, and web
hook. The core:

```python
run = Run(job, llm=transports.for_job(access), cache=cache, settings=s, budget_usd=b, emit=sink)
await extract(run, pdf=path)             # running -> awaiting_review | failed
await verify(run, selected_claim_ids)    # awaiting_review -> done | failed
# API: runner.submit / select / get / subscribe / delete. WS: snapshot, then frames.
```

## Shape

**Core structure: a job is the fold of its events.** During a run, `Job` (`job.py`)
changes only through `Job.apply(event)`. `Run.record(event)` applies the event and
emits `EventFrame(version, event)`, synchronously, with no `await` in between. `Event`
is a discriminated union of 11 kinds whose payloads are domain values (`Stage`,
`Claim`, `Step`, `Finding`). Values are frozen, so every revision is a copy recorded by
id. The golden harness gains one assertion that pins the design: replaying the frames
over the initial job yields the final job.

1. **Pipeline.** LangGraph goes. `audit/pipeline.py` has two coroutines:
   - `extract`: parse → planner → atomizer → check-worthiness → shortlist → review opens.
   - `verify`: review closes → verify ∥ consistency → skeptic → merge → confidence → reporter.

   Each stage lives in the module that owns its knowledge (`claims`, `verifier`,
   `skeptic`, `consistency`, `confidence`, `reporter`) and records its own stage events.

   - **Pause and resume:** the pause is the persisted `awaiting_review` status. The
     document is the full resume state: candidates carry `Claim.context`, and spend is
     the sum of trace costs. Resume is `verify(run, ids)` on the loaded job.
   - **Budget:** `Run.ask` checks spend before each call and after recording the call's
     cost. `BudgetExceeded` cancels sibling tasks in its `TaskGroup`; the gateway cancels
     their MiroMind responses. `verify` catches `except* AuditFailed`, scores the
     partial findings, skips the reporter, and ends the job `failed` with the reason.
   - **Verifier failures** are `Failed` answers. They become flagged uncertain findings
     on their real trace and never abort.
   - **Cancellation** records `Finished(failed, message)` and re-raises.
   - **Merge:** consistency starts with verification because it reads only claims. Its
     findings are built after the skeptic, against final verdicts. No branch reads
     another's in-flight state (per separate-before-serializing-shared-state).
2. **Lifecycle.** Four states: `running → awaiting_review → running → done | failed`,
   enforced in `apply`. There is no `queued`, and a crash is `failed` plus a `failure`
   reason. `Runner` holds the live runs (capped, 429 when full) and per-job subscriber
   queues. It saves at creation and when `extract` or `verify` returns, never per
   event. Check-and-start and snapshot-and-subscribe run with no `await` in between, so
   no locks are needed. On startup, stored `running` jobs get the same
   `Finished(failed)` event; on shutdown, cancelled runs save partial results.
3. **Persistence.** One `jobs` row: indexed projections (owner, status, title,
   created_at, counts, cost) plus `document = model_dump_json(exclude_computed_fields=True)`.
   Loading is `model_validate_json`, lossless by construction (verified against the
   repo's pydantic 2.13). The projections are computed from the document inside `save`.
   The resume state is the document. The verdict cache is its own table, keyed by
   normalized text, domain, and version. It stores finding + evidences + **trace**, so a
   hit replays a real trace. It is written once, after the merge. Migrations are
   squashed into one revision, applied at startup.
4. **Trace protocol.** Every connection gets `SnapshotFrame(job)`, then `EventFrame`s,
   and a closing snapshot when the run ends. **The sequence is `Job.version`**: owned by
   the aggregate, stored with it, and monotonic across the pause, resume, and restarts.
   Reconnecting is connecting: no history buffer, TTL, `after` cursor, or event
   persistence. Queued frames at or below the snapshot's version are dropped, which
   closes the load-vs-resume race. A slow client is dropped and resnapshots.
5. **LLM layer.** `Transports` is opened once per process: a pooled httpx client, one
   token bucket, tenacity, and `httpx-sse` (already a dependency; the hand-written SSE
   decoder is deleted). `Llm` is per job and binds the BYOK key and model. `Task`
   (agent, route, prompt, output model, token cap) sits next to each prompt. The surface
   is `engine(task)` and `ask(task, prompt, on_step) -> Answered | Failed`. One JSON
   contract with one repair round covers both providers. Every MiroMind attempt is
   priced onto its trace, failed parses included.
6. **API.** `Services` is built in the lifespan. Typed dependencies (`Principal`,
   `JobRead`, `JobManage`, `OwnerScope`, `MiroMindKey`) replace `app.state` reach-ins.
   One `POST /jobs` takes multipart `pdf` or `text`, parsed at the boundary into
   `PdfUpload | TextInput`, then one `runner.submit`. BYOK resolves header → saved key →
   server key → 400; the model is a `Literal`. Access is two pure functions, `can_read`
   and `can_manage`. The database is required.
7. **Module map:** `domain`, `job`, `documents`, `config`, `llm/`, `audit/`, `store/`,
   `uploads`, `runner`, `api/`, `cli` (see `sketch/argus/__init__.py`). Deleted:
   `orchestrator/`, `agents/`, `engineering.py`, `trace_bus/`, `storage/`, `cache/`,
   `db/`, `models/`, `security/`, `miromind/`, `job_query.py`, `access.py`, and the
   langgraph dependencies.
8. **Web types.** `argus schema` writes one serialization-mode JSON Schema. Tools:
   `json-schema-to-typescript` → committed `web/lib/generated/argus.ts`, and CI fails on
   drift. The web reducer `applyEvent` mirrors `Job.apply`, pinned by a parity fixture
   from the golden run. It replaces `trace-payload.ts`, marker steps, `LiveFinding`,
   and the 16-kind switch.

**Interface depth.**
- `Run`/`extract`/`verify` hide sequencing, fan-out, cache, skeptic selection, merge,
  scoring, budget, recording, and failure handling.
- `Llm` hides providers, SSE, retries, rate limits, repair, pricing, and cancellation.
- `Runner` hides tasks, capacity, fan-out, persistence timing, and races.

Exposed: `Job` and `Event`, which are the product's data.

**Deliberately absent:** event persistence, mid-phase checkpoints, a queue,
multi-process runners, DeepSeek in the budget.

## Synthesis decision

_Placeholder: filled in by arena._

## Defects fixed by construction

1. **Lossy persistence:** one Pydantic document, no id prefixing, `Step.trace_id`
   deleted (nesting says it).
2. **LangGraph replay fights:** deleted. The pause is a status plus the document, and
   phase B runs once.
3. **Stages computed twice:** a stage exists only as start and finish events. Its
   engine comes from `Llm.engine`, and shortlist/review are split so each has one
   outcome.
4. **`interrupted` ambiguity:** `awaiting_review` is durable and shown as active; a
   crash is `failed` plus a reason.
5. **Sequence restart and non-atomic publish:** sequence = `Job.version`, stored. Apply
   and fan-out happen in one synchronous step.
6. **Skeptic mutation and a dead filter:** findings are frozen. Consistency findings
   are built after the skeptic, against final verdicts.
7. **Untyped protocol:** a discriminated union of domain values plus a generated TS
   union. The web folds events; no synthesized markers.
8. **Duplication:** one submit route and runner path, one pipeline for both inputs, one
   JSON contract, dependencies instead of `app.state`, and no `repo is None`.
9. **Side-effect writes:** the pipeline does no I/O beyond LLM calls and the cache. The
   runner persists; the CLI writes its own file.

**Also fixed:**
- The budget is checked only after all verifications finish.
- Failed parses are never charged.
- Resume resets spend to $0.
- The rate limit is per job, and there is no connection pooling.
- A timeout does not cancel the response.
- The skeptic runs sequentially.
- The reporter runs after an abort.
- PDF parsing blocks the event loop.
- `pdf_path` leaks server paths.
- Deleting a running job resurrects it, and uploads are never removed.

## Delivery sequence

Every commit keeps pytest/ruff/mypy and vitest/tsc/eslint green. Goldens stay
identical or are regenerated in that commit with a reviewed diff. Risk goes first,
after prerequisites.

1. **Document store** (1). The xfail round-trip test passes. Goldens identical.
2. **`Claim.context`** at the gate. Golden: claims gain `context`. A prerequisite for 3.
3. **LangGraph → `Run` + `extract` + `verify`** (2, 9). Old payloads, `_build_stages`,
   and the start-time filter are kept verbatim, so **goldens are identical**. This
   proves the riskiest step is a pure refactor. The langgraph dependencies go.
4. **LLM gateway.** One JSON contract, `httpx-sse`, shared transports, one trace per
   call, failed attempts charged, budget in `Run.ask`, cancel on timeout or abort.
   Golden: costs, traces.
5. **Consistency after the skeptic** (6). Golden: redundant overreach on `a_2` and `c1`
   drops.
6. **Single-source stages**, shortlist/review split (3). Golden: stored stages equal
   live ones.
7. **Status machine** (4). Goldens identical; the flow test asserts `awaiting_review`.
8. **Generated web types.** The mirror and the parity script are deleted. No behavior
   change.
9. **Typed events, fold, and snapshot + tail**, backend and web together (5, 7). Golden:
   the events are re-canonicalized, the Job gains `version` and stage `status`, and the
   fold assertion is added.
10. **API layer** (8). Dependencies, one submit route, BYOK dependency, access
    functions, the database required, and delete that cancels the run and removes the
    upload.

## Tradeoffs accepted

- A hard crash loses a running phase's progress since the last save, in exchange for
  no per-event writes. Graceful shutdown keeps partial results.
- Snapshots of several MB are resent on reconnect, in exchange for a stateless,
  restart-proof protocol.
- There are two reducers (Python, TS) pinned by a fixture, in exchange for a live view
  that renders the final `Job` type.
- The budget-crossing call keeps its trace and cost but loses its output. In-flight
  siblings are cancelled, and MiroMind may bill their partial tokens unrecorded.
- The atomizer and check-worthiness calls become traces, in exchange for uniform
  accounting. `version` also counts heartbeats.

## Alternatives considered

- **Keep LangGraph, used properly** (durable checkpointer, `interrupt`). It lost
  because the interrupted node re-executes on resume, and checkpoint blobs become a
  second, opaque source of truth. Days-long pauses would depend on checkpoint
  compatibility across versions. It exposes reducers and `Command` to every node and
  hides nothing a fixed DAG needs.
- **A persisted event log as the source of truth**, with replay from a sequence
  number. It gives lossless crash recovery, but costs a database write per
  multi-KB step, doubles storage, and keeps cursors on both ends. Snapshot + tail
  gives clients the same guarantee.
- **A recorder with purpose-built methods** (mutate and publish). It is a smaller
  change, but consistency would rest on every method's discipline instead of one
  tested invariant.
- **Six tables with a fixed mapping.** The aggregate is only read and written whole,
  and a per-field mapping is where defect 1 came from.

## Open questions and risks

- Is recreating existing databases acceptable, production included?
- Should a graceful shutdown pause jobs for resumption instead of failing them?
- Should `failed` with partial coverage read as "partial" in the UI?
- Should `awaiting_review` jobs expire, with their uploads purged?
- Should DeepSeek spend stay outside the budget?
- Is the shortlist/review stage split acceptable in the UI?
- Can the demo-only fields move to a web-only `DemoJob`?
- Risk: commit 9 is a large web change. Its guardrails are the parity fixture and the
  golden fold assertion.

## Next implementation step

Land the document store (`jobs` row + `document`, squashed migration, `JobStore`) and
flip the strict xfail round-trip test to pass.
