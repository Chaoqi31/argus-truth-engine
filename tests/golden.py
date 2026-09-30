"""Golden-snapshot helpers: a live fake LLM server and canonical audit output.

A golden file pins what an audit produces, the final Job and the events
that built it, in a form that ignores random ids, timestamps, and the
interleaving of work that runs concurrently. Regenerate after an intentional
change with ``ARGUS_UPDATE_GOLDEN=1 uv run pytest`` and review the diff; the
same run rewrites the recorded runs the web's fold is tested on.
"""

from __future__ import annotations

import difflib
import json
import os
import socket
import threading
import time
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI

from argus.config import Settings
from argus.models.job import EventFrame, Job
from tests.fake_llm import FakeLLM

GOLDEN_DIR = Path(__file__).parent / "golden"
RUNS_DIR = Path(__file__).parents[1] / "web" / "tests" / "fixtures" / "runs"
_TIMESTAMP_KEYS = {"created_at", "completed_at", "started_at", "retrieved_at"}


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port: int = sock.getsockname()[1]
        return port


@contextmanager
def serve(app: FastAPI) -> Iterator[str]:
    """Run ``app`` on a real localhost socket for the duration of the block."""
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline:
            raise RuntimeError("server did not start")
        time.sleep(0.01)
    try:
        yield f"127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@contextmanager
def fake_llm_server(fake: FakeLLM | None = None) -> Iterator[tuple[str, FakeLLM]]:
    fake = fake or FakeLLM()
    with serve(fake.app()) as host:
        yield f"http://{host}", fake


def audit_settings(base_url: str, *, cheap_llm: bool, **overrides: Any) -> Settings:
    """Settings that point both LLM providers at the fake server."""
    return Settings(
        **{
            "miromind_api_key": "fake",
            "miromind_base_url": f"{base_url}/v1",
            "miromind_retry_base_delay_s": 0.001,
            "cheap_llm_api_key": "fake" if cheap_llm else "",
            "cheap_llm_base_url": base_url,
            "max_claims_to_verify": 6,
            "cache_enabled": False,
            **overrides,
        }
    )


def llm_calls(fake: FakeLLM) -> dict[str, int]:
    counts = Counter(f"{r['api']}:{r['task']}" for r in fake.requests)
    return dict(sorted(counts.items()))


class _Ids:
    """Maps random ids to stable, content-derived placeholders."""

    def __init__(self) -> None:
        self.names: dict[str, str] = {}
        self._taken: Counter[str] = Counter()

    def assign(self, raw: str | None, name: str) -> None:
        if raw is None or raw in self.names:
            return
        self._taken[name] += 1
        n = self._taken[name]
        self.names[raw] = name if n == 1 else f"{name}#{n}"

    def rewrite(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {
                k: "<ts>" if k in _TIMESTAMP_KEYS and v is not None else self.rewrite(v)
                for k, v in value.items()
            }
        if isinstance(value, list):
            return [self.rewrite(v) for v in value]
        if isinstance(value, str):
            return self.names.get(value, value)
        return value


def _ids_for(job: dict[str, Any]) -> _Ids:
    ids = _Ids()
    ids.assign(job["id"], "JOB")
    traces = sorted(
        job["traces"],
        key=lambda t: (
            t["agent"],
            t["claim_id"] or "",
            t["usage"]["response_ids"],
            len(t["steps"]),
        ),
    )
    for trace in traces:
        name = f"trace:{trace['agent']}:{trace['claim_id'] or '-'}"
        ids.assign(trace["id"], name)
        trace_name = ids.names[trace["id"]]
        for response_id in trace["usage"]["response_ids"]:
            ids.assign(response_id, f"{trace_name}/response")
        for i, step in enumerate(trace["steps"]):
            ids.assign(step["id"], f"{trace_name}/step{i}")
    findings = sorted(
        job["findings"],
        key=lambda f: (f["agent"], f["claim_id"], f["verdict"], f["summary"]),
    )
    for finding in findings:
        ids.assign(finding["id"], f"finding:{finding['agent']}:{finding['claim_id']}")
        finding_name = ids.names[finding["id"]]
        for i, evidence_id in enumerate(finding["evidence_ids"]):
            ids.assign(evidence_id, f"{finding_name}/evidence{i}")
    orphans = sorted(
        (e for e in job["evidences"] if e["id"] not in ids.names),
        key=lambda e: (e["url"] or "", e["snippet"]),
    )
    for i, evidence in enumerate(orphans):
        ids.assign(evidence["id"], f"evidence:orphan{i}")
    return ids


def canonical_job(job: dict[str, Any], ids: _Ids | None = None) -> dict[str, Any]:
    ids = ids or _ids_for(job)
    out: dict[str, Any] = ids.rewrite(job)
    out["pdf_path"] = Path(job["pdf_path"]).name if job["pdf_path"] else ""
    out["findings"] = sorted(out["findings"], key=lambda f: f["id"])
    out["evidences"] = sorted(out["evidences"], key=lambda e: e["id"])
    out["traces"] = sorted(out["traces"], key=lambda t: t["id"])
    return out


def canonical_events(frames: list[dict[str, Any]], ids: _Ids) -> dict[str, list[Any]]:
    """Group events by what they change: a stage, a trace, a finding, or the
    job itself. Order is kept within a group; across groups it depends on
    which concurrent work finished first."""
    buckets: dict[str, list[Any]] = {}
    for frame in frames:
        event = frame["event"]
        kind = event["type"]
        if kind in ("stage_started", "stage_finished"):
            bucket = f"stage:{event['key']}"
        elif kind == "trace_opened":
            bucket = ids.names[event["trace"]["id"]]
        elif kind in ("step_recorded", "trace_closed"):
            bucket = ids.names[event["trace_id"]]
        elif kind == "finding_recorded":
            bucket = ids.names[event["finding"]["id"]]
        else:
            bucket = "job"
        buckets.setdefault(bucket, []).append(ids.rewrite(event))
    return dict(sorted(buckets.items()))


def snapshot(
    job: dict[str, Any], frames: list[dict[str, Any]] | None, fake: FakeLLM
) -> dict[str, Any]:
    ids = _ids_for(job)
    out = {"job": canonical_job(job, ids), "llm_calls": llm_calls(fake)}
    if frames is not None:
        out["events"] = canonical_events(frames, ids)
    return out


def replayed(initial: Job, frames: list[EventFrame]) -> Job:
    """``initial`` with every frame applied, both as the web receives them."""
    job = Job.model_validate_json(initial.document_json())
    for frame in frames:
        job.apply(EventFrame.model_validate_json(frame.model_dump_json()).event)
    return job


def record_run(name: str, initial: Job, frames: list[EventFrame], final: Job) -> None:
    """Write a run for the web's fold to replay, when goldens are updated."""
    if os.environ.get("ARGUS_UPDATE_GOLDEN") != "1":
        return
    job = final.model_dump(mode="json")
    ids = _ids_for(job)
    run = {
        "initial": ids.rewrite(initial.model_dump(mode="json")),
        "frames": [ids.rewrite(f.model_dump(mode="json")) for f in frames],
        "final": ids.rewrite(job),
    }
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(run, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    (RUNS_DIR / f"{name}.json").write_text(rendered, encoding="utf-8")


def assert_golden(name: str, actual: dict[str, Any]) -> None:
    path = GOLDEN_DIR / f"{name}.json"
    rendered = json.dumps(actual, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if os.environ.get("ARGUS_UPDATE_GOLDEN") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered, encoding="utf-8")
        return
    assert path.exists(), f"missing golden {path}; run with ARGUS_UPDATE_GOLDEN=1"
    expected = path.read_text(encoding="utf-8")
    if rendered != expected:
        diff = difflib.unified_diff(
            expected.splitlines(), rendered.splitlines(), "golden", "actual", lineterm=""
        )
        shown = "\n".join(list(diff)[:120])
        raise AssertionError(
            f"{name} drifted from {path}. If the change is intended, regenerate with "
            f"ARGUS_UPDATE_GOLDEN=1 and review the diff.\n{shown}"
        )
