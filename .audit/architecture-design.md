# Argus target design (arena synthesis)

Inputs are in `.audit/arena/`: the grounding and rubric both lanes and the
judge worked from, both candidates' rationale and caller's-view usage, and the
blind cross-judge verdict. Candidate A came from the Fable lane, candidate B
from the Opus lane. The codex and grok lanes were out of quota (HTTP 402).

## Pick

Base: **candidate B, "a job is the fold of its events"**. My rubric scoring
had B ahead; the blind cross-judge (Fable, max effort) scored A 28/30 and
B 29/30 and picked B, arguing that B's core invariant (every change to a job
goes through `Job.apply`, values are immutable, the golden replays the
stream and must rebuild the job) would mean rewriting A, while A's good ideas
graft onto B one commit at a time.

The shape, in one screen:

- `Job` is the aggregate. During a run it changes only through
  `Job.apply(event)`. `Run.record(event)` applies and emits one
  `EventFrame(version, event)` with no await in between. `Job.version` is the
  sequence number, stored with the document, so it keeps counting across the
  review pause and restarts.
- Events are one Pydantic discriminated union carrying domain values (Stage,
  Claim, Step, Finding), never dicts. The web gets generated TypeScript types
  and folds frames with the same semantics as `Job.apply`.
- The pipeline is two coroutines, `extract(run)` and `verify(run, claim_ids)`.
  The pause is the stored `awaiting_review` status; the stored job is the
  complete resume state (claims carry `context`).
- Status machine: `running -> awaiting_review -> running -> done | failed`,
  enforced by `apply`.
- LLM access: process-wide transports (pooled httpx, one token bucket,
  tenacity, httpx-sse) plus a per-job `Llm` bound to the BYOK key and model.
  One JSON parse-and-repair contract for both providers. Every LLM call is one
  trace with its cost.
- Store: one `jobs` row, projections plus the document (landed in 51d4d1b).

## Grafts

1. Replay from a sequence number (A). A live run keeps a bounded buffer of its
   frames; a reconnect with `after=v` gets the missed frames when the buffer
   covers them and a snapshot otherwise. Keeps the grounding's "WS trace with
   replay from seq" without sending a multi-MB snapshot on every blip.
2. Save the selection before verification starts (A). The runner stores the
   job right after `ClaimsSelected`, so a crash mid-verify cannot quietly put
   the job back into review or lose its spend.
3. Interruption is not failure (A). `Finished(failed)` carries a typed
   failure with a kind (budget, interrupted, error) instead of a free string.
   Not a fifth status.

## Risks and the checks that answer them

1. The Python and TypeScript folds drift. Record parity fixtures for a budget
   that binds mid-verify, a cancel, and a cache-hit rerun, not only the happy
   path; a vitest fails when an event type in the generated union is missing
   from the fixtures; compare computed fields too.
2. Snapshots are large. Serialize each version once and share the bytes
   across subscribers and GETs; graft 1 keeps reconnects cheap.
3. The hard budget leaks under concurrency. Reserve a per-call ceiling before
   each MiroMind call and release it when the trace closes; add a golden run
   whose budget binds mid-verify.

## Delivery, as executed

B's sequence, adjusted where the code showed a better cut:

1. Document store (51d4d1b).
2. `Claim.context` at the review gate (9463ab4).
3. LangGraph out (e87b3f3). Single-source stages moved into this commit: the
   pause must carry the extraction stages, and the post-hoc rebuild could not
   survive without the checkpoint. Events, sequences, LLM calls and every Job
   field except stages are unchanged against the previous goldens.
4. Consistency findings filtered at the merge after the skeptic; the skeptic
   returns revised copies and honors its concurrency setting.
5. LLM gateway and budget reservation.
6. Domain values, typed events and the fold: `Job.apply`, `Run.record`,
   versions across the pause, the status machine, snapshot plus replay, the
   web reducer and generated types, parity fixtures.
7. API layer: dependencies, one submit path, database required, delete
   cancels, the CLI writes its own output.
8. Web vocabulary and demo types; docs and ops.
