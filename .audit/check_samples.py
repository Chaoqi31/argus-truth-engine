import json
from pathlib import Path

for name in ("web/public/sample-findings.json", "web/public/sample-findings-legal.json"):
    job = json.loads(Path(name).read_text())
    stages = job.get("stages", [])
    steps = [s for t in job.get("traces", []) for s in t.get("steps", [])]
    print(name)
    print("  job keys missing from the model:", [
        k for k in ("version", "cost_usd", "total_tokens", "claims_total", "claims_audited")
        if k not in job
    ])
    print("  stages:", [(s.get("key"), "name" in s, s.get("status")) for s in stages])
    print("  steps:", len(steps), "with trace_id:", sum("trace_id" in s for s in steps),
          "with sequence:", sum("sequence" in s for s in steps),
          "with parent_step_id:", sum("parent_step_id" in s for s in steps))
    kinds = sorted({s.get("type") for s in steps})
    print("  step types:", kinds)
