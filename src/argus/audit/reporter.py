"""The reporter: an executive summary of a finished audit."""
from __future__ import annotations

from argus.agents.reporter import REPORT, build_reporter_input
from argus.audit.run import Run
from argus.llm import Failed, FailureReason
from argus.log import log
from argus.models.domain import StageKey
from argus.models.job import ReportWritten, StageFinished, StageStarted

_FAILED: dict[FailureReason, str] = {
    "timeout": "Reporter timed out",
    "unparseable": "Reporter could not parse a result",
    "request_error": "Reporter request failed",
}


async def write_report(run: Run) -> None:
    run.record(StageStarted(key=StageKey.REPORTER, engine=run.llm.engine(REPORT)))
    findings = list(run.job.findings)
    summary = "No report generated"
    if findings:
        answer = (
            await run.ask(REPORT, build_reporter_input(list(run.job.claims), findings))
        ).answer
        if isinstance(answer, Failed):
            log.warning("audit.reporter_failed", reason=answer.reason, error=answer.detail[:300])
            summary = _FAILED[answer.reason]
        else:
            run.record(ReportWritten(markdown=answer.output.executive_summary_md))
            summary = "Executive summary generated"
    run.record(StageFinished(key=StageKey.REPORTER, summary=summary))
