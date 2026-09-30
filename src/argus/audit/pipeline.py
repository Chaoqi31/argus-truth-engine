"""The audit pipeline: two coroutines over one `Run`.

    extract:  parse -> planner -> atomizer -> check-worthiness -> shortlist -> review
    verify:   review -> (verify -> skeptic) with consistency alongside
                     -> consistency findings -> confidence -> reporter

The review pause is the job's `awaiting_review` status, and the stored job is
all `verify` needs. Neither coroutine raises for an audit that fails: each
ends the job failed, with the reason. Cancellation ends it failed as well,
then propagates. The pipeline stores nothing and writes no files; its callers
do that.
"""
from __future__ import annotations

import asyncio
from collections.abc import Collection, Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from argus.audit import claims as extraction
from argus.audit import consistency, reporter, skeptic, verifier
from argus.audit.confidence import score_findings
from argus.audit.run import AuditFailed, Run
from argus.log import log
from argus.models.domain import Engine, StageKey
from argus.models.job import (
    ClaimsSelected,
    Failure,
    FailureKind,
    Finished,
    ReviewReady,
    StageFinished,
    StageStarted,
)
from argus.pdf.parser import ParsedDoc, parse_pdf


async def extract(run: Run) -> None:
    """running -> awaiting_review, or failed. With no claims to review there
    is nothing to pause for, and the job goes straight on to done."""
    with _ends_job_on_error(run):
        document = await _parse(run)
        claims = await extraction.plan(run, document)
        claims = await extraction.atomize(run, claims)
        claims = await extraction.keep_checkworthy(run, claims)
        candidates = extraction.shortlist(run, claims, document)
        run.record(StageStarted(key=StageKey.REVIEW, engine=Engine.DETERMINISTIC))
        run.record(ReviewReady(claims=tuple(candidates)))
    if run.job.status == "awaiting_review" and not run.job.claims:
        await verify(run, ())


async def verify(run: Run, claim_ids: Collection[str]) -> None:
    """awaiting_review -> done, or failed. ``claim_ids`` are the candidates the
    reviewer kept (`Job.check_selection`)."""
    with _ends_job_on_error(run):
        n_candidates = len(run.job.claims)
        selected = set(claim_ids)
        run.record(
            ClaimsSelected(claim_ids=tuple(c.id for c in run.job.claims if c.id in selected))
        )
        run.record(
            StageFinished(
                key=StageKey.REVIEW,
                summary=f"{len(run.job.claims)} of {n_candidates} claim(s) selected",
                metrics={"n_candidates": n_candidates, "n_selected": len(run.job.claims)},
            )
        )
        async with asyncio.TaskGroup() as group:
            checking = group.create_task(consistency.check(run))
            await verifier.verify_claims(run)
            await skeptic.challenge(run)
        consistency.record_findings(run, checking.result())
        await verifier.remember(run)
        score_findings(run)
        # A report of an audit the budget stopped would read as complete.
        if run.stopped_by_budget:
            raise run.budget_exceeded()
        await reporter.write_report(run)
        run.record(Finished(status="done", completed_at=datetime.utcnow()))


async def _parse(run: Run) -> ParsedDoc:
    run.record(StageStarted(key=StageKey.PARSE, engine=Engine.DETERMINISTIC))
    job = run.job
    if job.input_mode == "text":
        document = extraction.text_document(job.input_text or "")
        summary = f"Read {len(document.full_text)} chars of input text"
    else:
        try:
            document = await asyncio.to_thread(parse_pdf, Path(job.pdf_path))
        except Exception as exc:
            raise AuditFailed(
                Failure(
                    kind=FailureKind.ERROR,
                    message=f"The PDF could not be read: {type(exc).__name__}: {exc}"[:300],
                )
            ) from exc
        summary = f"Parsed {len(document.pages)} page(s) · {len(document.full_text)} chars"
    run.record(
        StageFinished(
            key=StageKey.PARSE,
            summary=summary,
            metrics={"pages": len(document.pages), "chars": len(document.full_text)},
        )
    )
    return document


@contextmanager
def _ends_job_on_error(run: Run) -> Iterator[None]:
    """A run never leaves its job running because something went wrong."""
    try:
        yield
    except asyncio.CancelledError as exc:
        _fail(
            run,
            Failure(
                kind=FailureKind.INTERRUPTED,
                message=str(exc) or "The audit was stopped before it finished.",
            ),
        )
        raise
    except Exception as exc:
        cause = _first_cause(exc)
        if isinstance(cause, AuditFailed):
            _fail(run, cause.failure)
        else:
            log.exception("audit.crashed", job_id=run.job.id)
            _fail(
                run,
                Failure(kind=FailureKind.ERROR, message=f"{type(cause).__name__}: {cause}"[:300]),
            )


def _first_cause(exc: BaseException) -> BaseException:
    """What went wrong, out of the groups a TaskGroup wraps it in."""
    while isinstance(exc, BaseExceptionGroup):
        exc = exc.exceptions[0]
    return exc


def _fail(run: Run, failure: Failure) -> None:
    if run.job.status == "running":
        run.record(Finished(status="failed", failure=failure, completed_at=datetime.utcnow()))
