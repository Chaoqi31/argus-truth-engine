#!/usr/bin/env python3
"""Lightweight parity check between Python domain models and web/lib/types.ts.

Run locally:
    uv run python scripts/check_type_parity.py

CI: .github/workflows/ci.yml (type-parity job).
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = ROOT / "src" / "argus" / "models" / "domain.py"
TYPES_TS = ROOT / "web" / "lib" / "types.ts"

PAIRED_TYPES = (
    "Claim",
    "Evidence",
    "Step",
    "ReasoningTrace",
    "ConfidenceBreakdown",
    "CorrectedInfo",
    "ReasoningStep",
    "VerificationStep",
    "EvidenceQuality",
    "ClaimCoverage",
    "ComputationValue",
    "ComputationCheck",
    "SkepticCounterevidence",
    "SkepticReview",
    "Finding",
    "StageFilteredClaim",
    "Stage",
    "BenchmarkExpectedClaim",
    "BenchmarkSpec",
    "Job",
)

TS_RENAME: dict[str, str] = {
    "ConfidenceBreakdown": "ConfidenceBreakdownData",
}

# Fields intentionally kept server-side (not mirrored in the web contract).
PY_ONLY_FIELDS: dict[str, set[str]] = {
    "Finding": {"from_cache"},
    "Job": {"auto_review"},
}


def _python_fields(class_name: str, source: str) -> set[str]:
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            fields: set[str] = set()
            for item in node.body:
                if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    fields.add(item.target.id)
                elif isinstance(item, ast.Assign):
                    for target in item.targets:
                        if isinstance(target, ast.Name):
                            fields.add(target.id)
            return fields - PY_ONLY_FIELDS.get(class_name, set())
    raise ValueError(f"class {class_name} not found in domain.py")


def _strip_ts_comments(source: str) -> str:
    return re.sub(r"/\*[\s\S]*?\*/", "", source)


def _ts_fields(type_name: str, source: str) -> set[str]:
    cleaned = _strip_ts_comments(source)
    pattern = rf"export interface {type_name}\s*\{{([^}}]*)\}}"
    match = re.search(pattern, cleaned, re.DOTALL)
    if not match:
        raise ValueError(f"interface {type_name} not found in types.ts")
    body = match.group(1)
    fields: set[str] = set()
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        name = stripped.split(":", 1)[0].split("?", 1)[0].strip()
        if name and not name.startswith("|"):
            fields.add(name)
    return fields


def main() -> int:
    py_source = DOMAIN.read_text(encoding="utf-8")
    ts_source = TYPES_TS.read_text(encoding="utf-8")
    errors: list[str] = []

    for py_name in PAIRED_TYPES:
        ts_name = TS_RENAME.get(py_name, py_name)
        try:
            py_fields = _python_fields(py_name, py_source)
            ts_fields = _ts_fields(ts_name, ts_source)
        except ValueError as exc:
            errors.append(str(exc))
            continue

        missing_in_ts = py_fields - ts_fields
        missing_in_py = ts_fields - py_fields

        if missing_in_ts:
            errors.append(
                f"{py_name}: fields in domain.py missing from types.ts "
                f"({ts_name}): {sorted(missing_in_ts)}"
            )
        if missing_in_py:
            errors.append(
                f"{py_name}: fields in types.ts ({ts_name}) missing from "
                f"domain.py: {sorted(missing_in_py)}"
            )

    if errors:
        print("Type parity check FAILED:\n", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print(f"Type parity OK for {len(PAIRED_TYPES)} paired types.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
