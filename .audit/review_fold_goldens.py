"""Review the goldens across the fold: the old stream of hand-built payloads
against the new stream of typed events that build the job.

    uv run python .audit/review_fold_goldens.py <old-rev>

The event sections share no format, so they are summarised, not diffed. The
jobs are compared after normalising the shape changes the fold makes on
purpose, so that what remains is a change in what the audit found, cost or
recorded:

- stages lose `name` and gain `status`; `review_gate` becomes `shortlist`
  plus a `review` stage that stays open until the reviewer selects;
- steps lose `trace_id`, `sequence` and `parent_step_id`;
- every LLM call leaves a trace, so the atomizer and check-worthiness calls
  now have one, and a failed verifier call keeps its steps and usage;
- the job gains `version`.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any

NEW_TRACE_AGENTS = {"atomizer", "checkworthiness"}


def load(rev: str | None, path: Path) -> dict[str, Any]:
    if rev is None:
        return json.loads(path.read_text())
    shown = subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, text=True,
                           check=True)
    return json.loads(shown.stdout)


def normalise_old(job: dict[str, Any]) -> dict[str, Any]:
    job = json.loads(json.dumps(job))
    for stage in job["stages"]:
        stage.pop("name")
    job["stages"] = [s for s in job["stages"] if s["key"] != "review_gate"]
    for trace in job["traces"]:
        for step in trace["steps"]:
            for key in ("trace_id", "sequence", "parent_step_id"):
                step.pop(key)
    return job


def normalise_new(job: dict[str, Any]) -> dict[str, Any]:
    job = json.loads(json.dumps(job))
    job.pop("version")
    for stage in job["stages"]:
        assert stage.pop("status") == "done", stage
    job["stages"] = [s for s in job["stages"] if s["key"] not in ("shortlist", "review")]
    job["traces"] = [t for t in job["traces"] if t["agent"] not in NEW_TRACE_AGENTS]
    return job


def walk(a: Any, b: Any, path: str, out: list[str]) -> None:
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(a.keys() | b.keys()):
            if k not in a:
                out.append(f"+ {path}.{k}: {json.dumps(b[k])[:100]}")
            elif k not in b:
                out.append(f"- {path}.{k}")
            else:
                walk(a[k], b[k], f"{path}.{k}", out)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            walk(x, y, f"{path}[{i}]", out)
    elif a != b:
        out.append(f"~ {path}: {json.dumps(a)[:100]} -> {json.dumps(b)[:100]}")


def main() -> None:
    old_rev = sys.argv[1]
    for path in sorted(Path("tests/golden").glob("text_*.json")):
        old, new = load(old_rev, path), load(None, path)
        print(f"== {path.stem}")
        print(f"  llm_calls: {'same' if old['llm_calls'] == new['llm_calls'] else 'CHANGED'}")
        kinds = Counter(e["type"] for bucket in new["events"].values() for e in bucket)
        print(f"  new events: {dict(sorted(kinds.items()))}")
        new_job = new["job"]
        print("  new stages:", [(s["key"], s["status"], s["summary"]) for s in new_job["stages"]
                               if s["key"] in ("shortlist", "review")])
        print("  new traces:", sorted(t["id"] for t in new_job["traces"]
                                     if t["agent"] in NEW_TRACE_AGENTS))
        out: list[str] = []
        walk(normalise_old(old["job"]), normalise_new(new_job), "job", out)
        print(f"  remaining job differences: {len(out)}")
        for line in out:
            print("   ", line)


if __name__ == "__main__":
    main()
