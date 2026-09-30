# Argus backend redesign: grounding for the design arena

Repository (read only): /Users/chaoqi/Dev/argus-truth-engine/.claude/worktrees/architecture-refactor
Branch head at arena time: see `git log --oneline -8` there. Plan and decision
trail: `.audit/architecture-refactor-plan.md`, `.audit/architecture-refactor.tsv`.

## What Argus is

A service that audits AI-generated documents. A user uploads a PDF or pastes
text. Argus extracts factual claims, pauses so a human can pick which claims
to verify (paid deep research per claim), verifies each picked claim with
MiroMind deep research (web search, fetch, python), challenges shaky
high-risk verdicts with a second MiroMind "skeptic" call, checks the claims
for internal contradictions, scores confidence deterministically, and writes
an executive summary. Every finding keeps a reasoning trace (the model's
tool steps) and evidence. A Next.js web app streams the run live over a
WebSocket and renders the final Job.

## The current backend (src/argus, ~9.5k lines after phase 1 deletions)

- `models/domain.py`: Pydantic domain models. `Job` is the aggregate:
  claims, findings, traces (each with steps), evidences, stages, plus run
  metadata (status, cost, tokens, coverage counts). Also demo-only fields
  (`scenario_label`, `persona`, `benchmark`) used by the web demo fixtures.
- `models/miromind.py`: typed SSE events of the MiroMind Responses API.
- `miromind/client.py`, `miromind/sse.py`: MiroMind transport (POST
  background response, GET SSE stream with reconnect), token bucket rate
  limit, tenacity retry.
- `llm/cheap_client.py`: OpenAI-compatible chat client (DeepSeek) with its
  own JSON extract/repair loop.
- `agents/*.py`: one module per LLM task: prompt text, output Pydantic
  schema, run function. `agents/base.py` holds `AgentRunner` (consume a
  MiroMind stream into `StreamCollection` of Steps, validate JSON, one repair
  round) and `complete_routed` (non-web tasks go to DeepSeek when configured,
  else MiroMind). `confidence_calculator.py` and `domain_hints.py` are pure.
- `engineering.py`: grab bag of BoundedRunner (semaphore wrapper),
  BudgetTracker, the cost table, idempotency key, TokenBucket, retry.
- `orchestrator/`: LangGraph. `pipeline.py` builds two StateGraphs (phase A:
  parse, planner, atomizer, checkworthiness, review_gate; phase B:
  unified_verifier then skeptic, consistency in parallel from START,
  confidence, reporter). `context.py` holds the TypedDict state with dict
  merge reducers, `_Ctx` (clients, settings, budget, semaphores, publisher,
  cache, `is_resuming`), `_Publisher` (numbers and publishes trace events).
  `entry.py` has `audit_pdf`, `audit_text` (near duplicates) and
  `audit_resume`. `assemblers.py` has pure transforms from agent output to
  domain objects and hand-built event payload dicts. `nodes/*.py` are the
  node closures. `checkpointer.py` builds a LangGraph sqlite/postgres saver.
- `api/`: FastAPI. `runner.py` is an in-process `JobRunner` (records and
  asyncio tasks in dicts; `submit`, `submit_text`, `resume` are near
  duplicates, each building a per-job Settings copy for BYOK keys).
  `jobs.py` routes, `auth.py` (Supabase JWT), `access.py`, `account.py`
  (saved encrypted API keys), `share.py` (share links), `events.py`
  (product analytics), `ws.py` (trace WebSocket), `job_query.py`.
- `db/`: SQLAlchemy async. The Job aggregate is spread over six tables
  (jobs, claims, findings, traces, steps, evidences) with hand-written
  from_domain/to_domain and `job::id` prefixing. Plus users, user_api_keys,
  audit_share_links, audit_access_logs, analytics_events, finding_cache.
  Eight Alembic migrations.
- `cache/`: verifier result cache in the DB keyed by normalized claim text,
  content domain and verifier prompt version.
- `trace_bus/`: `TraceBus` protocol with one implementation, `InProcessBus`
  (per-job history list + subscriber queues, history TTL).
- `storage/`: `Storage` protocol with one implementation, `LocalFsStorage`.
- `pdf/parser.py`: pdfplumber with a pymupdf fallback per page.
- `cli.py`: `argus audit <pdf>` (auto review, writes findings.json) and
  `argus serve`.

## Verified problems (evidence in the harness and the decision trail)

1. Persistence is lossy: `reasoning_chain`, `flags`, `parent_claim_id` are
   dropped and `step.trace_id` is rewritten on a DB round trip. The
   aggregate is only ever saved and loaded whole (save deletes and
   re-inserts the tree).
2. LangGraph drives a fixed pipeline. The code fights its replay semantics:
   `is_resuming` flags to avoid re-publishing, a `finish_stage` guard,
   `__interrupt__` detection, an `aborted` flag checked at the top of every
   node, two graphs sharing one thread id. Resume re-runs phase B anyway.
3. Stage summaries are computed twice (nodes publish one, `_build_stages`
   recomputes another), so the persisted stage and the live event disagree,
   and persisted engines are wrong when MiroMind runs planner/consistency/
   reporter.
4. Job status `interrupted` means both "paused for claim review" and
   "worker crashed". The web history page shows jobs awaiting review as
   failed. Status values parsing/planning/... exist but are never set.
5. Event sequence numbers restart at 1 when a run resumes after review (a
   new publisher per run). The web client drops events whose sequence is not
   above the last one it saw, so the UI misses the start of verification.
   Sequence assignment and bus publish are not atomic either.
6. The skeptic mutates Finding objects in place while the consistency
   branch runs in parallel; the consistency node's "drop logical flaws on
   claims the verifier already flagged" filter never fires, because the
   consistency branch starts at the same time as the verifier and sees no
   verifier findings.
7. The trace protocol is untyped dicts on both sides. Event kinds:
   started, stage (started/finished), claim (started/finished), step (both
   live tool steps and fake trace-summary payloads), heartbeat, finding (a
   hand-built partial Finding dict), atomized, filtered, claims_deduped,
   claims_capped, review_ready, review_submitted, resumed, finished, failed.
   The web hook `web/app/audit/hooks/use-audit-run.ts` synthesizes stage
   markers from five of these kinds and special-cases step payloads by agent
   name, even though `stage` events already carry the data.
8. Duplication: `audit_pdf`/`audit_text`; runner `submit`/`submit_text`/
   `resume`; two JSON extract/repair implementations; `request.app.state.
   argus` reached into from every route; `repo is None` branches everywhere
   although the API cannot list, share or resume without a DB.
9. The orchestrator writes `<input>.findings.json` next to every upload as a
   side effect (debug artifact), and persists to the DB itself.

## Constraints

- Owner's rules (AGENTS.md): no backward compatibility, remove obsolete
  paths, no compatibility layers or data migrations; simplest design that
  fully meets current requirements; no speculative abstraction; prefer
  established libraries when they reduce complexity; modular with clear
  separation; long-term decisions, no stopgaps.
- Product behavior to keep: PDF and text input; claim extraction with
  optional DeepSeek (MiroMind fallback when no DeepSeek key); atomize,
  check-worthiness filter, dedupe, cost cap on claims; human claim review in
  the API (always on; the UI never sends auto_review); CLI runs without the
  pause; per-claim verification with bounded concurrency, heartbeats while a
  claim runs long, per-response timeout, verifier result cache; skeptic on
  high-risk verdicts below a confidence threshold; consistency checker;
  deterministic confidence breakdown and sourcing flags; executive summary;
  hard USD budget per job that aborts the run; BYOK MiroMind key per request
  (header, or a saved encrypted key, or the server key) and per-run model
  choice; live trace over WebSocket with replay from a sequence number;
  job history list, delete, rerun, share links, access log, product
  analytics events; Supabase auth optional, self-hosted mode without auth.
- Deployment: one Fly machine (backend) + Vercel (web); self-host compose
  with Postgres; SQLite works for dev/tests. A single process runs jobs.
- The web app is in the same repo and can change in the same branch. Its
  types are hand-mirrored in `web/lib/types.ts` today.
- Equivalence gate: `tests/golden/*.json` snapshots (built by
  `tests/golden.py` from a fake LLM server in `tests/fake_llm.py`) pin the
  final Job and the grouped event stream. Output changes must be deliberate
  and reviewed. Known bugs above are allowed to change the goldens, each in
  its own commit.

## The design question

What should the backend look like if it were written today with these
requirements? In particular:

1. The pipeline: how stages are expressed, how the review pause and resume
   work without LangGraph (or argue to keep it), how budget exhaustion,
   verifier failures and cancellation flow, how the skeptic and consistency
   results merge without shared mutation.
2. The job lifecycle: the status state machine, where transitions are
   enforced, the in-process runner, restart behavior (jobs running when the
   process died).
3. Persistence: the job store shape (the plan leans to one row per job with
   indexed metadata plus one JSON document), how the resume state is stored,
   and how the verifier cache fits.
4. The trace event protocol: one typed model, sequence ownership, what the
   web client needs, how the final Job relates to the stream.
5. The LLM layer: MiroMind transport, DeepSeek client, the agent/task
   modules, JSON repair, cost accounting.
6. The API layer: dependencies, one submit path for PDF and text, BYOK
   credential resolution, access control.
7. The module map of `src/argus` and what each module owns.
8. How the web app gets its types (e.g. generated from Pydantic JSON Schema).
