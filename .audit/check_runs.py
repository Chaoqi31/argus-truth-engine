"""Fold the recorded runs the web replays: initial + frames must equal final.

The fixtures carry ``<ts>`` for every timestamp and a stable name for every
random id, and the final job also carries the computed totals. Both are
normalized here the same way they are when written.
"""
import json
from pathlib import Path
from typing import Any

from argus.models.job import EventFrame, Job

COMPUTED = ("claims_audited", "claims_total", "cost_usd", "total_tokens")
TIMESTAMP_KEYS = {"created_at", "completed_at", "started_at", "retrieved_at"}
PLACEHOLDER_TS = "2026-01-01T00:00:00"


def _load(document: dict[str, Any]) -> Job:
    return Job.model_validate(
        {
            key: _unstamp(value)
            for key, value in document.items()
            if key not in COMPUTED
        }
    )


def _unstamp(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _unstamp(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_unstamp(item) for item in value]
    if isinstance(value, str) and value == "<ts>":
        return PLACEHOLDER_TS
    return value


def _stamped(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "<ts>" if key in TIMESTAMP_KEYS and item is not None else _stamped(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_stamped(item) for item in value]
    return value


def main() -> None:
    for path in sorted(Path("web/tests/fixtures/runs").glob("*.json")):
        run = json.loads(path.read_text())
        job = _load(run["initial"])
        for raw in run["frames"]:
            job.apply(EventFrame.model_validate(_unstamp(raw)).event)
        assert job.version == len(run["frames"]), (path.name, job.version)
        folded = _stamped(job.model_dump(mode="json"))
        assert folded == run["final"], (path.name, "folded != final")
        kinds = {frame["event"]["type"] for frame in run["frames"]}
        print(f"{path.name}: {job.version} frames, {len(kinds)} event types, folds")


if __name__ == "__main__":
    main()
