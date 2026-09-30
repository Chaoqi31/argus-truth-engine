"""Golden-snapshot helpers: a live fake LLM server and canonical audit output.

A golden file pins what an audit produces, the final Job and the event
stream, in a form that ignores random ids, timestamps, and the interleaving of
work that runs concurrently. Regenerate after an intentional change with
``ARGUS_UPDATE_GOLDEN=1 uv run pytest tests/test_golden_pipeline.py`` and
review the diff.
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
from tests.fake_llm import FakeLLM

GOLDEN_DIR = Path(__file__).parent / "golden"
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
        key=lambda t: (t["agent"], t["claim_id"], t["miromind_response_id"], len(t["steps"])),
    )
    for trace in traces:
        name = f"trace:{trace['agent']}:{trace['claim_id']}"
        ids.assign(trace["id"], name)
        trace_name = ids.names[trace["id"]]
        ids.assign(trace["miromind_response_id"], f"{trace_name}/response")
        steps = sorted(trace["steps"], key=lambda s: s["sequence"])
        for i, step in enumerate(steps):
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
    for trace in out["traces"]:
        trace["steps"] = sorted(trace["steps"], key=lambda s: s["id"])
    return out


def canonical_events(events: list[dict[str, Any]], ids: _Ids) -> dict[str, list[Any]]:
    """Group events by the entity they describe; order is kept within a group.

    Steps streamed live but never stored on the job (a verifier attempt whose
    output could not be parsed) get placeholders from their claim and agent.
    """
    buckets: dict[str, list[Any]] = {}
    for ev in events:
        kind, payload = ev["kind"], ev["payload"]
        if kind == "heartbeat":
            continue
        if kind == "stage":
            bucket = f"stage:{payload['key']}"
        elif "claim_id" in payload:
            bucket = f"claim:{payload['claim_id']}:{payload.get('agent', '-')}"
        else:
            bucket = "global"
        step = payload.get("step")
        if isinstance(step, dict):
            ids.assign(step["trace_id"], f"live:{bucket}/response")
            ids.assign(step["id"], f"live:{bucket}/step")
        buckets.setdefault(bucket, []).append({"kind": kind, "payload": ids.rewrite(payload)})
    return dict(sorted(buckets.items()))


def snapshot(job: dict[str, Any], events: list[dict[str, Any]], fake: FakeLLM) -> dict[str, Any]:
    assert events[-1]["kind"] in {"finished", "failed"}
    ids = _ids_for(job)
    return {
        "job": canonical_job(job, ids),
        "events": canonical_events(events, ids),
        "sequences": [ev["sequence"] for ev in events],
        "llm_calls": llm_calls(fake),
    }


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
