"""Raw SSE line decoder for MiroMind Responses API.

We cannot use the openai-python SDK because it drops fields it doesn't know
(e.g., reasoning_steps), and we need every field to build a faithful
ReasoningTrace.

This module parses an iterable of raw bytes chunks into a stream of typed
ResponseEvent objects.
"""
from __future__ import annotations

from collections.abc import Iterable, Iterator

from argus.models.miromind import ResponseEvent, parse_event


def sse_iter_events(chunks: Iterable[bytes]) -> Iterator[ResponseEvent]:
    """Yield typed events parsed from raw SSE byte chunks.

    Handles:
      - Multi-chunk delivery (TCP segmentation): buffers across chunks.
      - SSE comments (`:` lines): ignored per spec.
      - Multi-line `data:` payloads: joined with newlines.
      - Blank line as event terminator.
    """
    buffer = ""
    data_lines: list[str] = []

    for chunk in chunks:
        buffer += chunk.decode("utf-8", errors="replace")

        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.rstrip("\r")

            if line == "":
                if data_lines:
                    payload = "\n".join(data_lines)
                    data_lines = []
                    if payload == "[DONE]":
                        continue
                    yield parse_event(payload)
                continue

            if line.startswith(":"):
                continue  # comment / heartbeat

            if line.startswith("data: "):
                data_lines.append(line[len("data: ") :])
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :])
            # We deliberately ignore `event:` / `id:` / `retry:` lines —
            # the payload's "type" field is authoritative.

    # Flush trailing event without final blank line (rare).
    if data_lines:
        payload = "\n".join(data_lines)
        if payload != "[DONE]":
            yield parse_event(payload)
