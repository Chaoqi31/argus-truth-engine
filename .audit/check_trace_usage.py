"""Check that each trace's new `usage` carries the old token counts, and the
job totals are unchanged, comparing the goldens with HEAD."""

import json
import subprocess
from pathlib import Path

AGENTS = {"UnifiedVerifier": "verifier", "Consistency": "consistency", "Skeptic": "skeptic",
          "Reporter": "reporter"}


def key(trace: dict, old: bool) -> tuple[str, str | None]:
    if not old:
        return trace["agent"], trace["claim_id"]
    claim = None if trace["claim_id"].startswith("(") else trace["claim_id"]
    return AGENTS.get(trace["agent"], trace["agent"]), claim


for path in sorted(Path("tests/golden").glob("*.json")):
    shown = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True,
                           check=True).stdout
    old, new = json.loads(shown)["job"], json.loads(path.read_text())["job"]
    before = {key(t, True): t for t in old["traces"]}
    after = {key(t, False): t for t in new["traces"]}
    assert before.keys() == after.keys(), before.keys() ^ after.keys()
    mismatched = [
        k for k, t in before.items()
        if (t["total_tokens"], t["reasoning_tokens"], t["num_search_queries"])
        != tuple(after[k]["usage"][f] for f in
                 ("total_tokens", "reasoning_tokens", "num_search_queries"))
    ]
    print(f"{path.stem}: {len(before)} traces, token mismatches {mismatched}; "
          f"cost {old['cost_usd']} -> {new['cost_usd']}; "
          f"tokens {old['total_tokens']} -> {new['total_tokens']}; "
          f"coverage {old['claims_audited']}/{old['claims_total']} -> "
          f"{new['claims_audited']}/{new['claims_total']}")
