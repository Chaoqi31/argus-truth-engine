"""Derive live job progress from trace event history."""
from __future__ import annotations

from typing import Any

from argus.trace_bus.base import TraceBus, TraceEvent


def derive_progress(history: list[TraceEvent]) -> dict[str, Any]:
    state: dict[str, Any] = {
        "finished_stages": [],
        "current_stage": None,
        "current_claim": None,
        "claims_total": 0,
        "claims_started": set(),
        "claims_finished": set(),
        "last_heartbeat": None,
    }

    for ev in history:
        if ev.kind == "stage":
            _apply_stage_progress(state, ev.payload)
        elif ev.kind == "claim":
            _apply_claim_progress(state, ev.payload)
        elif ev.kind == "heartbeat":
            state["last_heartbeat"] = ev.payload

    return {
        "finished_stages": state["finished_stages"],
        "current_stage": state["current_stage"],
        "claims_started": len(state["claims_started"]),
        "claims_finished": len(state["claims_finished"]),
        "claims_total": state["claims_total"],
        "current_claim": state["current_claim"],
        "last_heartbeat": state["last_heartbeat"],
    }


def _apply_stage_progress(state: dict[str, Any], payload: dict[str, Any]) -> None:
    status = payload.get("status")
    key = payload.get("key")
    if not isinstance(key, str):
        return
    if status == "started":
        state["current_stage"] = {
            "key": key,
            "name": payload.get("name"),
            "engine": payload.get("engine"),
        }
    elif status == "finished":
        if key not in state["finished_stages"]:
            state["finished_stages"].append(key)
        current = state["current_stage"]
        if current and current.get("key") == key:
            state["current_stage"] = None


def _apply_claim_progress(state: dict[str, Any], payload: dict[str, Any]) -> None:
    status = payload.get("status")
    claim_id = payload.get("claim_id")
    total = payload.get("total")
    if isinstance(total, int):
        state["claims_total"] = max(state["claims_total"], total)
    if not isinstance(claim_id, str):
        return
    if status == "started":
        state["claims_started"].add(claim_id)
        state["current_claim"] = {
            "claim_id": claim_id,
            "text": payload.get("text"),
            "index": payload.get("index"),
            "total": total,
        }
    elif status == "finished":
        state["claims_finished"].add(claim_id)
        current = state["current_claim"]
        if current and current.get("claim_id") == claim_id:
            state["current_claim"] = None


async def progress_from_trace(bus: TraceBus, job_id: str) -> dict[str, Any]:
    try:
        async with bus.subscribe(job_id) as sub:
            history = [ev async for ev in sub.iter_history()]
    except Exception:
        return {}
    return derive_progress(history)
