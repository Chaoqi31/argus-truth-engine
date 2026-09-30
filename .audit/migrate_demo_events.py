"""Migrate the demo samples to the job-as-events shape.

Stages lose their display name (the web writes it now) and gain a status; the
old combined review gate becomes the shortlist and review stages the pipeline
emits today; steps lose the fields that only the old trace bus needed. The
job's version is the number of events its own replay emits.
"""
import json
from pathlib import Path

PIPELINE = [
    "parse", "planner", "atomizer", "checkworthiness", "shortlist", "review",
    "verify", "skeptic", "consistency", "confidence", "reporter",
]
TRACE_STAGE = {"verifier": "verify", "skeptic": "skeptic", "consistency": "consistency"}


def event_count(job: dict) -> int:
    stages = {s["key"] for s in job["stages"]}
    traces = job["traces"]
    findings = job["findings"]
    counted: set[str] = set()
    n = 0
    for key in PIPELINE:
        if key not in stages:
            continue
        n += 2
        if key == "review":
            n += 2
            continue
        if key in ("verify", "skeptic", "consistency", "confidence"):
            for trace in traces:
                if TRACE_STAGE.get(trace["agent"]) != key:
                    continue
                n += 2 + len(trace["steps"])
                for finding in findings:
                    if finding["reasoning_trace_id"] == trace["id"]:
                        counted.add(finding["id"])
                        n += 1
        elif key == "reporter" and job["audit_report_md"]:
            n += 1
    n += sum(1 for f in findings if f["id"] not in counted)
    return n + 1  # finished


def split_review_gate(stage: dict) -> list[dict]:
    metrics = stage["metrics"]
    before = metrics.get("n_before", metrics.get("n_verifying", 0))
    after = metrics.get("n_after", before)
    selected = metrics.get("n_verifying", after)
    return [
        {
            "key": "shortlist",
            "engine": stage["engine"],
            "status": "done",
            "summary": f"{after} claim(s) shortlisted for review",
            "metrics": {"n_before": before, "n_after": after, "n_shortlisted": after},
            "filtered_claims": [],
        },
        {
            "key": "review",
            "engine": stage["engine"],
            "status": "done",
            "summary": f"{selected} of {after} claim(s) selected",
            "metrics": {"n_candidates": after, "n_selected": selected},
            "filtered_claims": [],
        },
    ]


for name in ("web/public/sample-findings.json", "web/public/sample-findings-legal.json"):
    path = Path(name)
    job = json.loads(path.read_text())

    stages: list[dict] = []
    for stage in job["stages"]:
        stage.pop("name", None)
        stage["status"] = "done"
        if stage["key"] == "review_gate":
            stages.extend(split_review_gate(stage))
        else:
            stages.append(stage)
    job["stages"] = stages

    for trace in job["traces"]:
        for step in trace["steps"]:
            for gone in ("trace_id", "sequence", "parent_step_id"):
                step.pop(gone, None)

    job["version"] = event_count(job)
    path.write_text(json.dumps(job, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{name}: {job['version']} events, {len(job['stages'])} stages")
