"""Migrate the demo jobs in web/public to the 6c-2 domain shape.

Agents take the `Agent` vocabulary, job-level traces lose their "(planner)"-
style pseudo claim ids, and each trace's counts move into `usage` with the
engine that served it. The demo jobs recorded only the job's total spend, so
it is split over the MiroMind traces in proportion to their tokens: the job
total is exact, the per-trace split an estimate. The result is validated and
re-serialised by the backend `Job` model, so the files match the schema the
web types are generated from.
"""

import json
from pathlib import Path

from argus.models.domain import Job

AGENTS = {"UnifiedVerifier": "verifier", "Consistency": "consistency", "Skeptic": "skeptic",
          "Reporter": "reporter", "planner": "planner"}
COMPUTED = ("cost_usd", "total_tokens", "claims_total", "claims_audited")


def migrate(raw: dict) -> Job:
    cost = raw["cost_usd"]
    traces = raw["traces"]
    miromind = [t for t in traces if not t["miromind_response_id"].startswith("deepseek:")]
    tokens = sum(t["total_tokens"] for t in miromind)
    shares = [round(cost * t["total_tokens"] / tokens, 6) for t in miromind]
    shares[-1] = round(cost - sum(shares[:-1]), 6)
    share = {id(t): s for t, s in zip(miromind, shares, strict=True)}
    for trace in traces:
        response_id = trace.pop("miromind_response_id")
        trace["agent"] = AGENTS[trace["agent"]]
        if trace["claim_id"].startswith("("):
            trace["claim_id"] = None
        trace["engine"] = "miromind" if id(trace) in share else "deepseek"
        trace["usage"] = {
            "response_ids": [response_id],
            "total_tokens": trace.pop("total_tokens"),
            "reasoning_tokens": trace.pop("reasoning_tokens"),
            "num_search_queries": trace.pop("num_search_queries"),
            "cost_usd": share.get(id(trace), 0.0),
        }
    for finding in raw["findings"]:
        finding["agent"] = AGENTS[finding["agent"]]
    for key in COMPUTED:
        raw.pop(key)
    job = Job.model_validate(raw)
    assert job.cost_usd == cost, (job.cost_usd, cost)
    return job


for name in ("sample-findings.json", "sample-findings-legal.json"):
    path = Path("web/public") / name
    raw = json.loads(path.read_text())
    before = {k: raw[k] for k in COMPUTED}
    job = migrate(raw)
    path.write_text(json.dumps(job.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
    print(name, before, "->", {k: getattr(job, k) for k in COMPUTED})
