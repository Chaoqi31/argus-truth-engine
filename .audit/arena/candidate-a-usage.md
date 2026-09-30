# Usage: the caller's view

Three callers exist: the CLI, the in-process job runner behind the API, and
the WebSocket trace route. Everything else in `src/argus` exists to make these
three call sites short. When a type in the sketch disagrees with a call site
here, the call site wins.

One sentence: a `Job` is a Pydantic document that a pipeline coroutine fills
in. `extract(run)` turns the source into reviewed candidate claims and parks
the job in `awaiting_review`. `verify(run)` turns the job's claims into
findings and a report and parks it in `done`. Both take the same `Run` (job +
LLM + budget + cache + limits + a synchronous `emit` callback). The runner adds
persistence, event numbering and the human pause; the CLI adds none of them.

## 1. CLI: `argus audit report.pdf`

No database, no EventLog, no cache. The CLI drives both phases back to back,
prints events as they happen, and writes a report only where asked. Nothing
inside the pipeline touches the filesystem except reading the PDF.

```python
# argus/cli.py
from argus.config import settings
from argus.domain.models import ContentDomain, Job, PdfSource, TextSource
from argus.llm import LLM, MiromindCredentials
from argus.pipeline.extraction import extract
from argus.pipeline.run import Budget, BudgetExceeded, Limits, Run
from argus.pipeline.verification import verify


async def _audit(path: Path, domain: ContentDomain, select: str, out: Path | None, budget_usd: float | None) -> int:
    s = settings()
    source = PdfSource(path=str(path.resolve()), filename=path.name) if path.suffix == ".pdf" else TextSource(text=path.read_text())
    job = Job.new(source=source, content_domain=domain)
    creds = MiromindCredentials(api_key=s.miromind_api_key, model=s.miromind_model)
    run = Run(
        job=job,
        llm=LLM.from_settings(s, creds),
        budget=Budget(limit_usd=budget_usd or s.job_budget_usd),
        cache=None,
        limits=Limits.from_settings(s),
        emit=print_event,                        # sync: (TraceEvent) -> None
    )
    try:
        async with run.llm:
            await extract(run)                   # queued -> extracting -> awaiting_review
            job.apply_review(choose(job.claims, select))   # all, or ids from the prompt / --select
            await verify(run)                    # awaiting_review -> verifying -> done
    except BudgetExceeded as e:
        job.fail(str(e))                         # findings so far are already on `job`
    if out:
        out.write_text(job.audit_report_md or job.model_dump_json(indent=2))
    typer.echo(f"{job.status}: {len(job.findings)} findings, {job.total_tokens} tokens, ${job.cost_usd:.2f}")
    return 0 if job.status is JobStatus.DONE else 1
```

There is no `auto_review` flag anywhere. Skipping the review is
`apply_review(all ids)` followed by `verify`. The golden harness does exactly
this with a fake `LLM` and an `emit` that appends to a list.

## 2. Job runner behind the API

The runner owns what the CLI does not need: saving the document at phase
end, numbering trace events, and the pause between phases. It never builds a
prompt, never talks to MiroMind, never computes a finding.

```python
# argus/runner.py (call sites inside the runner)

async def start(self, job: Job, credentials: MiromindCredentials) -> None:
    """POST /jobs, after the upload is stored. Raises RunnerCapacityError (429)."""
    self._require_capacity()
    await self._store.jobs.save(job)                                # status queued
    self._spawn(job, credentials, extract)

async def select_claims(self, job: Job, claim_ids: list[str], credentials: MiromindCredentials) -> Job:
    """POST /jobs/{id}/claims/select. Raises InvalidTransition (409), UnknownClaimIds (400), JobAlreadyRunning (409)."""
    if job.id in self._runs:
        raise JobAlreadyRunning(job.id)
    job.apply_review(claim_ids)                                     # awaiting_review only; status unchanged
    await self._store.jobs.save(job)
    self._spawn(job, credentials, verify)                           # verify() does awaiting_review -> verifying
    return job

def _spawn(self, job: Job, credentials: MiromindCredentials, phase: Phase) -> None:
    run = Run(
        job=job,
        llm=LLM.from_settings(self._settings, credentials),
        budget=Budget(limit_usd=self._settings.job_budget_usd, spent_usd=job.cost_usd),   # one cap across both phases
        cache=self._store.verifier_cache if self._settings.cache_enabled else None,
        limits=Limits.from_settings(self._settings),
        emit=lambda ev: self._events.publish(job.id, ev),           # synchronous
    )
    self._events.open(job.id, first_sequence=job.event_sequence + 1)   # numbering continues across the pause
    task = asyncio.create_task(self._drive(run, phase), name=f"job:{job.id}")
    self._runs[job.id] = task
    task.add_done_callback(lambda _: self._runs.pop(job.id, None))

async def _drive(self, run: Run, phase: Phase) -> None:
    """One phase, start to finish. The only place a job becomes failed or interrupted."""
    job = run.job
    try:
        async with run.llm:
            await phase(run)                                        # mutates run.job; raises on failure
    except asyncio.CancelledError:                                  # cancel() or shutdown()
        job.transition(JobStatus.INTERRUPTED)
        job.failure_reason = "cancelled"
    except Exception as e:                                          # BudgetExceeded, LLMError, PdfError, ...
        job.fail(f"{type(e).__name__}: {e}")
    job.event_sequence = self._events.last_sequence(job.id) + 1     # the phase-end event's number
    await self._store.jobs.save(job)                                # save first ...
    self._events.publish(job.id, self._phase_end(job))              # ... then tell clients to refetch
    self._events.close(job.id)                                      # ends every subscriber after that event

@staticmethod
def _phase_end(job: Job) -> TraceEvent:
    match job.status:
        case JobStatus.AWAITING_REVIEW: return ReviewReady(job_id=job.id, n_claims=len(job.claims))
        case JobStatus.DONE:            return RunFinished(job_id=job.id)
        case _:                         return RunFailed(job_id=job.id, status=job.status, reason=job.failure_reason or "")
```

Invariants the call sites rely on:

- `run.job` is written by exactly one coroutine at a time: the task in
  `_runs[job.id]`. Fan-out tasks inside `verify` return values; the phase
  coroutine merges them as they complete. No object is shared between
  concurrent tasks.
- The phase-end event (`review_ready`, `run_finished`, `run_failed`) is
  published after the save commits. A client that refetches on that event
  sees the state the event announces.
- A job in `awaiting_review` holds nothing in memory. Everything `verify`
  needs is in the document plus the credentials on the selection request, so
  the pause survives a process restart.
- Startup: `store.jobs.mark_interrupted()` flips `queued`, `extracting` and
  `verifying` jobs to `interrupted` through the state machine.
  `awaiting_review` is untouched.

## 3. WebSocket trace route

```python
# argus/api/ws.py
@router.websocket("/jobs/{job_id}/trace")
async def trace(ws: WebSocket, job_id: str, after: int = 0,
                state: AppState = Depends(app_state), ctx: AuthContext = Depends(auth_context)) -> None:
    job = await state.store.jobs.get_or_none(job_id)
    if job is None or not can_access(job, ctx, state.settings):
        await ws.close(code=CLOSE_FORBIDDEN)                         # 1008
        return
    await ws.accept()
    try:
        async for event in state.events.subscribe(job_id, after=after):   # history > after, then live, ends on close()
            await ws.send_text(event.model_dump_json())
    except SubscriberLagged:
        await ws.close(code=CLOSE_LAGGED, reason="lagged")           # 1011: client reconnects with ?after=
        return
    await ws.close(code=1000)
```

Wire format: the `TraceEvent` union serialized flat, one frame per event:
`{"kind": "finding", "job_id": "...", "sequence": 42, "at": "...", "finding": {...}}`.
`EventLog.publish` is synchronous: sequence assignment, history append and
fan-out happen with no await between them, so a subscriber never sees a gap or
a duplicate, and numbering continues across the review pause.

## 4. What the web does with it

```ts
// web/app/audit/hooks/use-audit-run.ts
const [live, dispatch] = useReducer(applyTraceEvent, initialRunState);
useEffect(() => {
  const sub = subscribeTrace({ wsBase, jobId, after: live.lastSequence, token,
    onEvent: dispatch, onClosed: refetch, onGiveUp: refetch });
  return () => sub.close();
}, [jobId]);
// applyTraceEvent is one exhaustive switch over event.kind (sketch/web/trace-reducer.ts).
// On review_ready, run_finished, run_failed and on close the hook refetches GET /jobs/{id}:
// the Job document is the source of truth; the stream is a projection of it. No polling.
```

Types come from `web/lib/api-types.ts`, generated from `argus export-schema`
(JSON Schema of `Job`, `JobSummary`, `TraceEvent`) by json-schema-to-typescript,
never hand-mirrored.
