"""Diff the goldens against HEAD after mapping the old vocabulary to the new.

Old agent names and "(planner)"-style pseudo claim ids are rewritten in the
HEAD golden first, so what remains is the real change.
"""

import json
import re
import subprocess
from pathlib import Path

AGENTS = {"UnifiedVerifier": "verifier", "Consistency": "consistency", "Skeptic": "skeptic",
          "Reporter": "reporter"}


def old_mapped(path: Path) -> object:
    text = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True,
                          check=True).stdout
    for pseudo in ("planner", "consistency", "reporter"):
        text = text.replace(f":({pseudo})", ":-")
        text = text.replace(f'"claim_id": "({pseudo})"', '"claim_id": null')
    for old, new in AGENTS.items():
        text = text.replace(f'"agent": "{old}"', f'"agent": "{new}"')
        text = re.sub(rf"(trace|finding):{old}:", rf"\1:{new}:", text)
        text = re.sub(rf":{old}([\"/])", rf":{new}\1", text)
    return json.loads(text)


def _keyed(items: list[object]) -> bool:
    return bool(items) and all(isinstance(x, dict) and "id" in x for x in items)


def walk(a: object, b: object, path: str, out: list[str]) -> None:
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(a.keys() | b.keys()):
            if k not in a:
                out.append(f"+ {path}.{k}")
            elif k not in b:
                out.append(f"- {path}.{k}")
            else:
                walk(a[k], b[k], f"{path}.{k}", out)
    elif isinstance(a, list) and isinstance(b, list) and _keyed(a) and _keyed(b):
        walk({x["id"]: x for x in a}, {y["id"]: y for y in b}, path + "[]", out)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            walk(x, y, f"{path}[{i}]", out)
    elif a != b:
        out.append(f"~ {path}: {json.dumps(a)[:80]} -> {json.dumps(b)[:80]}")


def _shape(line: str) -> str:
    return re.sub(r"\[\d+\]|\[\]\.[^.\s:]+", "[]", line.split(": ", 1)[0])


for path in sorted(Path("tests/golden").glob("*.json")):
    out: list[str] = []
    walk(old_mapped(path), json.loads(path.read_text()), "", out)
    shapes = sorted({_shape(line) for line in out})
    print(f"== {path.stem}: {len(out)} differences, by shape:")
    for shape in shapes:
        n = sum(1 for line in out if _shape(line) == shape)
        print(f"   {n:3d} {shape}")
