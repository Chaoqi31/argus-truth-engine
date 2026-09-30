# Argus backend: caller's usage (written before the types)

The types in `sketch/argus/` are derived from these call sites. Where the two
disagree, the call sites win.

## The whole public surface in one screen

```python
from argus.job import Job, JobStatus, PdfInput, TextInput, SnapshotFrame, EventFrame
from argus.llm import Transports, MiroMindAccess
from argus.audit import Run, extract, verify      # the pipeline: two coroutines and their context
from argus.runner import Runner                   # the API's in-process job runner
```

- A `Job` is the audit aggregate. During a run it changes only through
  `job.apply(event)`; every applied event bumps `job.version`.
- `Run` binds one job to what executing it needs (per-job LLM access, verdict cache,
  settings, budget, an event sink). `run.record(event)` applies the event and emits
  `EventFrame(version, event)`. Nothing else writes to the job.
- `extract(run, pdf=...)` moves a job from `running` to `awaiting_review` (or
  `failed`). `verify(run, claim_ids)` moves it from `awaiting_review` to `done` (or
  `failed`). Neither raises for audit failures; both re-raise cancellation after
  recording it.
- The pipeline does no persistence, no file writes, no HTTP. Callers own that.

## Call site 1: the CLI (`argus audit report.pdf -o findings.json`)

The CLI has no database, no pause, and no web client. It reviews by keeping every
candidate claim.

```python
async def audit_file(pdf: Path, output: Path, *, budget_usd: float, domain: ContentDomain) -> Job:
    settings = Settings()
    job = Job.create(input=PdfInput(filename=pdf.name), content_domain=domain)
    async with Transports.open(settings) as transports:
        run = Run(
            job,
            llm=transports.for_job(MiroMindAccess.from_settings(settings)),
            cache=None,                      # the verdict cache lives in the API database
            settings=settings,
            budget_usd=budget_usd,
            emit=print_progress,             # EventFrame -> one console line per finished stage
        )
        await extract(run, pdf=pdf)
        if job.status is JobStatus.AWAITING_REVIEW:
            await verify(run, [claim.id for claim in job.claims])
    output.write_text(job.model_dump_json(indent=2))     # the CLI's output, written by the CLI
    return job
```

## Call site 2: the job runner (API process)

Routes never touch the pipeline, the store, or tasks directly. They call four runner
methods.

```python
# POST /jobs (multipart: a `pdf` file or a `text` field)
job = await runner.submit(
    PdfUpload(filename=name, data=blob),        # or TextInput(text=text)
    content_domain=form.content_domain,
    owner_id=principal.user_id,
    access=MiroMindAccess(api_key=key, model=form.miromind_model or settings.miromind_model),
)
return SubmitResponse(job_id=job.id)            # 202; the run is already live

# POST /jobs/{id}/claims/select
await runner.select(job_id, body.claim_ids, access=access)     # 409 unless awaiting_review, 400 on unknown ids

# GET /jobs/{id}
job = await runner.get(job_id)                  # live fold while running, stored snapshot otherwise

# DELETE /jobs/{id}
await runner.delete(job_id)                     # cancels a live run first, then row + upload
```

Inside the runner, submit and select share one driver. The driver is the only place
that persists a job, and it persists at lifecycle boundaries only.

```python
async def submit(self, upload, *, content_domain, owner_id, access) -> Job:
    self._claim_slot()                                          # CapacityError -> 429
    job = Job.create(input=job_input(upload), content_domain=content_domain)   # PdfUpload -> PdfInput
    await self._store.create(job, owner_id=owner_id)
    pdf = await self._uploads.save(job.id, upload)              # None for text
    self._start(job, access, lambda run: extract(run, pdf=pdf))
    return job

async def select(self, job_id, claim_ids, *, access) -> None:
    job = await self._store.get(job_id)                         # awaiting_review jobs are never live
    job.check_selection(claim_ids)                              # NotAwaitingReview / UnknownClaims
    self._claim_slot()
    self._start(job, access, lambda run: verify(run, claim_ids))

async def _drive(self, run: Run, work: Callable[[Run], Awaitable[None]]) -> None:
    try:
        await work(run)
    finally:
        await asyncio.shield(self._store.save(run.job))        # pause, finish, cancel: one save
        self._live.pop(run.job.id)
```

Startup and shutdown are symmetrical and go through the same event path:

```python
await runner.recover()      # startup: stored `running` jobs get Finished(failed, "interrupted by a restart")
yield
await runner.shutdown()     # live runs are cancelled; each records Finished(failed) and is saved
```

## Call site 3: the WebSocket route (`/ws/jobs/{id}`)

Every connection gets a snapshot, then the tail. Reconnecting is the same as
connecting. There is no history buffer and no `after` parameter.

```python
@router.websocket("/ws/jobs/{job_id}")
async def job_live(ws: WebSocket, job_id: JobRead, runner: RunnerDep) -> None:
    await ws.accept()
    async with runner.subscribe(job_id) as feed:
        await ws.send_text(feed.snapshot_json)          # SnapshotFrame at version v, serialized at subscribe time
        if feed.terminal:
            return
        async for frame in feed.frames():               # EventFrame, version v+1, v+2, ... (gapless)
            await ws.send_text(frame.model_dump_json())
            if frame.event.type == "finished":
                job = await runner.get(job_id)
                await ws.send_text(SnapshotFrame(job=job).model_dump_json())   # authoritative end state
                return
    # feed overflow (slow client) ends frames(); the socket closes and the client reconnects.
```

## Call site 4: the golden harness (equivalence gate)

```python
frames: list[EventFrame] = []
job = Job.create(input=TextInput(text=AUDIT_TEXT), content_domain=ContentDomain.FINANCE)
initial = job.model_copy(deep=True)
async with Transports.open(settings) as transports:
    run = Run(job, llm=transports.for_job(access), cache=None, settings=settings,
              budget_usd=50.0, emit=frames.append)
    await extract(run)
    await verify(run, [c.id for c in job.claims])

assert_golden(name, snapshot(job, frames, fake))
replayed = initial
for frame in frames:
    replayed.apply(frame.event)
assert replayed == job                                # the stream IS the job's changelog
assert [f.version for f in frames] == list(range(1, job.version + 1))
```

## Call site 5: the web client

Types come from `web/lib/generated/argus.ts`, generated from the backend's JSON
Schema. The live view folds frames with the same semantics as `Job.apply`.

```ts
const { live, connection } = useLiveJob(jobId, auth);          // live = { job, heartbeats } | null
if (!live) return <Connecting state={connection} />;
const { job, heartbeats } = live;
if (job.status === "awaiting_review") return <ClaimReview review={reviewOf(job)!} />;  // job.claims + filtered
return <Cockpit job={job} live={job.status === "running"} heartbeats={heartbeats} />;
```
