"""Compare the golden snapshots of two revisions, section by section.

    uv run python .audit/compare_goldens.py <old-rev> [<new-rev>]

<new-rev> defaults to the working tree. Prints which sections of each golden
changed (events, sequences, llm_calls, and each top-level Job field), and for
changed list fields, which items differ and in which keys.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

GOLDEN_DIR = Path("tests/golden")


def load(rev: str | None, path: Path) -> dict[str, Any]:
    if rev is None:
        return json.loads(path.read_text())
    shown = subprocess.run(
        ["git", "show", f"{rev}:{path}"], capture_output=True, text=True, check=True
    )
    return json.loads(shown.stdout)


def item_key(item: Any, index: int) -> str:
    if isinstance(item, dict):
        for field in ("id", "key"):
            if field in item:
                return str(item[field])
    return f"#{index}"


def describe(field: str, old: Any, new: Any) -> list[str]:
    if not (isinstance(old, list) and isinstance(new, list)):
        return [f"  job.{field}: changed"]
    before = {item_key(v, i): v for i, v in enumerate(old)}
    after = {item_key(v, i): v for i, v in enumerate(new)}
    lines = [f"  job.{field}: {len(old)} -> {len(new)} items"]
    for key in sorted(before.keys() - after.keys()):
        lines.append(f"    - {key}")
    for key in sorted(after.keys() - before.keys()):
        lines.append(f"    + {key}")
    for key in sorted(before.keys() & after.keys()):
        a, b = before[key], after[key]
        if a != b and isinstance(a, dict) and isinstance(b, dict):
            keys = sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))
            lines.append(f"    ~ {key}: {', '.join(keys)}")
    return lines


def main() -> None:
    old_rev = sys.argv[1]
    new_rev = sys.argv[2] if len(sys.argv) > 2 else None
    for path in sorted(GOLDEN_DIR.glob("*.json")):
        old, new = load(old_rev, path), load(new_rev, path)
        print(f"== {path.stem}")
        for section in ("events", "sequences", "llm_calls"):
            print(f"  {section}: {'same' if old[section] == new[section] else 'CHANGED'}")
        for field in sorted(old["job"].keys() | new["job"].keys()):
            a, b = old["job"].get(field), new["job"].get(field)
            if a != b:
                print("\n".join(describe(field, a, b)))


if __name__ == "__main__":
    main()
