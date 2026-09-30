# Cross-judge verdict: Argus backend refactor base

In the table, paths are relative to that column's candidate directory (`/tmp/arena-argus/judge/A/` or `/tmp/arena-argus/judge/B/`): `argus/...` means `sketch/argus/...`, `web/...` means `sketch/web/...`, `USAGE.md` means `sketch/USAGE.md`. Outside the table, paths carry an `A/` or `B/` prefix. `repo/...` means `/tmp/arena-argus/repo/...`.

## 1. Scores

| # | Criterion | A | B |
|---|-----------|---|---|
| 1 | Defect coverage | **5**. One owner per defect: transition table `argus/domain/models.py:351-361`, document row `argus/store/tables.py:23`, sequence seeded from the document `argus/events.py:9-11`, branches return values merged at one point `argus/pipeline/verification.py:72-75`; `Finding` is immutable only by convention `argus/domain/models.py:263-264`. | **5**. One owner and one test: `Job.apply` is the only mutation `argus/job.py:265-289`, `Job.version` is the sequence `argus/job.py:223`, values are `frozen=True` `argus/domain.py:31-42`, and the golden fold assertion checks stream = job `USAGE.md:145-149`. |
| 2 | Reader load | **4**. A claim crosses `pipeline`, `tasks`, `llm`; status and sequence have one writer each `argus/domain/models.py:417-420`, `argus/events.py:5-8`; but the consistency stage is finished twice, in `_consistency` `argus/pipeline/verification.py:144-145` and again at the merge `:76`. | **5**. A claim crosses `argus/audit/verifier.py:58-105` -> `argus/audit/run.py:94-112` -> `argus/llm/__init__.py:111-127`; status, stages and version change only in `Job.apply`; consistency starts in `check` and finishes once in `record_findings` `argus/audit/consistency.py:59-71`. |
| 3 | Interface depth | **5**. `extract`/`verify` over one `Run` `argus/pipeline/run.py:67-74`, `JobStore` `argus/store/jobs.py:26-51`, `EventLog` `argus/events.py:47-74`, `LLM.complete/research` `argus/llm/client.py:110-142`; domain imports only pydantic; one leak, `VerifierCache` in `argus/pipeline/run.py:17`. | **5**. `extract`/`verify` over `Run.record/ask/replay` `argus/audit/run.py:53-118`, `Llm.ask -> Answered \| Failed` `argus/llm/__init__.py:69-127`, `Runner` `argus/runner.py:84-141`, `JobStore` `argus/store/jobs.py:39-71`; ORM confined to `argus/store/schema.py`; the same cache leak `argus/audit/run.py:31`. |
| 4 | Subtraction | **5**. Deletes LangGraph, `orchestrator/`, `trace_bus/`, `db/assemblers`, `cache/`, the migrations, web `types.ts` and the 4 s poll `rationale.md:118-129`; no `Protocol`/ABC; adds only `json-schema-to-typescript`. | **5**. Deletes more: also `db/`, `models/`, `security/`, `miromind/`, `job_query.py`, `access.py` `rationale.md:89-93`, and the hand-written SSE decoder for the declared `httpx-sse` `rationale.md:76-78`; four statuses to A's seven `argus/job.py:51-63`; no `Protocol`/ABC. |
| 5 | Deliverability | **4**. Six commits naming defects and checks `rationale.md:203-229`, concrete first step `rationale.md:182-187`; but commits 1 and 2 are large, and the LangGraph swap regenerates goldens in the same commit, so it is never shown to be a pure refactor `rationale.md:208-217`. | **4**. Ten commits with stated golden effects `rationale.md:149-175`; LangGraph removal kept golden-identical `rationale.md:157-159`; concrete first step `rationale.md:219-222`; but commit 9 bundles events, fold, snapshot and web, so the central invariant is proven last `rationale.md:170-172,216-217`. |
| 6 | Web contract | **5**. `TraceEvent` union and schema `argus/domain/events.py:118-137` -> generated `web/api-types.ts:1-9`; exhaustive reducer with no per-agent branch `web/trace-reducer.ts:44-46`; `?after=` resume `web/trace-ws.ts:3-8`. | **5**. Generated `Frame`/`Event` unions `argus/job.py:182-195,316-335`, exhaustive `switch (event.type)` `web/README.md:12`; the web folds into the backend's own `Job` and rejects version gaps `web/live-job.ts:34-49`; no per-agent branch. |
| | **Total** | **28 / 30** | **29 / 30** |

## 2. Base: B

Build on B. Its core rule, that a job is the fold of its events, closes defects 3, 5, 6 and 7 with one tested property (the golden fold assertion, `B/sketch/USAGE.md:145-149`) and frozen values (`B/sketch/argus/domain.py:31-42`), while A relies on each call site's discipline over a mutable `Job`, and A's own sketch already slips once (the consistency stage is finished twice). B's delivery proves the riskiest step, deleting LangGraph, as a golden-identical refactor before any behavior changes (`B/rationale.md:157-159`); A regenerates goldens in the same commit that swaps the pipeline (`A/rationale.md:214-217`). A's advantages are transport and lifecycle details that each graft onto B in one commit, while B's advantages are its core and would mean rewriting A. The totals are one point apart because the rubric tops out at 5; that asymmetry is what decides it.

## 3. Grafts from A into B

1. **Replay from a sequence number.** A `sketch/argus/events.py:12-20` (register and read history in one synchronous step; a lagging client is closed and resumes with `?after=`) and `A/sketch/web/trace-ws.ts:3-8`. Why: a reconnecting or lagging client gets only the frames it missed instead of B's whole several-MB snapshot (`B/rationale.md:181-182`), and grounding lists "replay from a sequence number" as behavior to keep (`grounding.md:126`), which B drops. Fit: a bounded per-run buffer keyed by B's `Job.version`, with a snapshot whenever the cursor is outside the buffer or from another run.
2. **Save the selection before verify starts.** A `sketch/argus/runner.py:44-48` (`apply_review`, `await save`, then `_spawn`). Why: B saves only at creation and when a phase returns (`B/rationale.md:58-59`, `B/sketch/argus/runner.py:101-109`), so a crash mid-verify silently reverts the stored job to `awaiting_review`, drops the verify traces, and lets a re-selection spend the per-job budget again. Fit: keep B's synchronous `JobBusy` check and slot claim first; A's order (check, then `await save`) lets two selects both pass (`A/sketch/USAGE.md:76-83`).
3. **Tell interruption apart from failure.** A `sketch/argus/domain/models.py:338-339` (`FAILED` for budget, LLM or parse errors; `INTERRUPTED` for a dead process or a cancel). Why: B ends every unsuccessful run as `failed` with `failure: str | None` (`B/sketch/argus/job.py:173-179`) filled with ad hoc strings (`B/sketch/argus/audit/pipeline.py:114-125`), so the UI and metrics can tell "rerun, not your fault" from "budget spent" only by parsing text. Fit: a typed failure value with a `kind` on B's `Finished`, not a fifth status.

## 4. Risks in B, with mitigations

1. **The Python and TypeScript folds drift.** `Job.apply` (`B/sketch/argus/job.py:265-289`) and `applyEvent` (`B/sketch/web/live-job.ts:39-49`) implement the same 11 cases, and the TypeScript side must also recompute `cost_usd`, `total_tokens`, `claims_total` and `claims_audited` (`B/sketch/argus/job.py:234-256`). The only parity fixture is the golden happy path (`B/sketch/web/live-job.ts:8-11`), run at `budget_usd=50.0` (`B/sketch/USAGE.md:140`) with instant fake responses, so `Finished(failed)`, stages forced to `FAILED`, traces left open by a cancel, cache replay and `Heartbeat` never reach it. Mitigation: record three more golden runs as parity fixtures (a budget that binds mid-verify, a cancel mid-verify, a cache-hit rerun); add a vitest that fails when any `Event["type"]` in the generated union is missing from the fixtures; compare computed fields too, not only the stored document.
2. **Snapshots are large and sent often.** Every connection, reconnect and dropped slow client gets the whole `Job` (`B/sketch/argus/job.py:316-323`, `B/sketch/argus/runner.py:157-160`); the live snapshot is serialized synchronously on the event loop (`B/sketch/argus/runner.py:130-131`), and `get` deep-copies the live fold on every call (`B/sketch/argus/runner.py:119-123`). At the several MB B expects (`B/rationale.md:181-182`), a slow client on a large job can cycle through drop and resnapshot while each serialization stalls every other job's stream. Mitigation: pin the largest golden document's size under a ceiling in a test; serialize each version once and share the bytes across subscribers and `GET`s; replace the deep copy with a copy of the top-level containers, which frozen values make safe; adopt graft 1.
3. **The hard budget leaks.** `Run.ask` checks spend before and after each call (`B/sketch/argus/audit/run.py:98,106`) while up to `unified_verifier_concurrency` claims run at once (`B/sketch/argus/audit/verifier.py:64-67`), so every in-flight call passes the pre-check and the job overshoots by up to concurrency minus one deep-research calls, plus the unrecorded partial spend of cancelled siblings (`B/rationale.md:185-186`), plus verify spend lost in a crash (graft 2). Grounding requires a hard cap that aborts the run (`grounding.md:124`), and no golden run reaches the budget. Mitigation: reserve a per-call ceiling before each MiroMind call (`spent + reserved + ceiling <= budget`, released at `TraceClosed`); save at each `StageFinished` as well as at selection; add a golden run whose budget binds mid-verify.

Not on this list: B's claim that commit 3 keeps goldens identical (`B/rationale.md:157-159`). If that claim is wrong, the golden gate fails in that commit; the three risks above fail silently.

## 5. Factual errors about today's code

Repo access: 11 `grep` calls and one `wc -l`. That is one grep over the cap of 10; two of the greps answered the same question about `use-audit-run.ts`.

**Candidate A.** Nothing found wrong. The one A claim I checked holds: the 4 s poll (`A/rationale.md:129`) is `repo/web/app/audit/hooks/use-audit-run.ts:221:    pollTimer = setInterval(poll, 4000);`.

**Candidate B, contradicted.** B lists `Stage.strategy` as never populated (`B/sketch/argus/domain.py:19`). `grep -rn -e "strategy=" -e "related_finding_ids" repo/src/argus` returned:

    repo/src/argus/orchestrator/pipeline.py:246:        strategy=ss.get("planner", {}).get("strategy"),

Today's stage builder fills the field from the planner's stage summary. The grep does not show whether the planner writes that key, so removing the field is a golden change to review in its own commit, not dead-code removal. The same grep supports B on `Finding.related_finding_ids`: every constructor passes `related_finding_ids=[]` (for example `repo/src/argus/orchestrator/assemblers.py:237`).

**Candidate B, not wrong but under-pinned.** B verified the lossless round trip against "the repo's pydantic 2.13" (`B/rationale.md:65`), but `repo/pyproject.toml:22:    "pydantic>=2.7",` does not guarantee that version. Raise the floor in commit 1.

**Candidate B, confirmed** (safe to rely on):

- Two id prefixes for findings: `unified_verifier.py:87: "id": f"fnd_{uuid4().hex[:12]}",` and `assemblers.py:196: id=f"f_{uuid4().hex[:12]}",`.
- Naive timestamps: 19 lines call `datetime.utcnow()`, for example `orchestrator/pipeline.py:388: job.completed_at = datetime.utcnow()`.
- The skeptic runs sequentially: `nodes/skeptic.py:125: for finding in findings:`, with no `gather` or `Semaphore` in that file, while `nodes/unified_verifier.py:165: results = await asyncio.gather(`.
- PDF parsing runs on the event loop: `grep -rn -e "to_thread" -e "run_in_executor" repo/src/argus` returned nothing.
- A timeout does not cancel the response: `miromind/client.py:179: async def cancel(self, response_id: str) -> None:` has one caller in the searched paths, `api/account.py:178: await client.cancel(response_id)`.
- `httpx-sse` is already declared: `repo/pyproject.toml:16: "httpx-sse>=0.4",`.
- Reads return a shape that is not a `Job`: `api/job_query.py:26: ) -> Job | RunningJobSnapshot | None:`.
- Resume resets spend, consistent with `orchestrator/pipeline.py:59: budget = BudgetTracker(max_usd=budget_usd)` (a fresh tracker, `engineering.py:64: spent_usd: float = 0.0`) and `pipeline.py:380: job.cost_usd = round(budget.spent_usd, 6)` (assigned, not added).

**Not settled by my greps:**

- B's "the budget is checked only after all verifications finish" (`B/rationale.md:138`): the tracker raises on every charge (`engineering.py:68: if self.spent_usd > self.max_usd:`) and the verifier logs `"orchestrator.budget_exceeded_at_specialist"` (`unified_verifier.py:248`); whether those charges happen inside or after the `gather` at line 165 is not shown.
- B's "the 16-kind switch" (`B/rationale.md:98`): `grep -c 'case "'` on `use-audit-run.ts` returned `0`; the switch may use single quotes or live in another file.
- B's `Route.DEEPSEEK_ONLY` skips atomize and check-worthiness without a DeepSeek key (`B/sketch/argus/llm/__init__.py:51`, `B/sketch/argus/audit/claims.py:92-110`), while grounding says non-web tasks fall back to MiroMind (`grounding.md:34-35`) and A keeps that fallback (`A/sketch/argus/llm/client.py:5,101`). Check today's atomizer before B's commit 4; if it falls back, route both tasks as `TEXT`.

**Correction to my own draft.** My candidate-A notes listed `json_repair` as a new dependency. It is already declared (`repo/pyproject.toml:32:    "json-repair>=0.30",`), and A never claimed otherwise.
