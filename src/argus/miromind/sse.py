"""Raw SSE line decoder for MiroMind Responses API.

We cannot use the openai-python SDK because it drops fields it doesn't know
(e.g., reasoning_steps), and we need every field to build a faithful
ReasoningTrace.

This module parses raw SSE byte chunks into a stream of typed ResponseEvent
objects. The core is :class:`SSEDecoder`, a *stateful* parser that buffers
across chunk boundaries — callers MUST feed every chunk to the *same* decoder
instance, never a fresh one per chunk, or events that straddle a TCP/HTTP chunk
boundary are lost (dropped characters → corrupted JSON / URLs downstream).
"""
from __future__ import annotations

from collections.abc import Iterable, Iterator

from argus.models.miromind import ResponseEvent, parse_event

_DATA_PREFIX = "data: "
_DATA_PREFIX_TIGHT = "data:"


class SSEDecoder:
    """Incremental SSE parser. Buffers across chunks; one instance per stream.

    Handles:
      - Multi-chunk delivery (TCP segmentation): buffers across ``feed`` calls.
      - SSE comments (`:` lines): ignored per spec.
      - Multi-line `data:` payloads: joined with newlines.
      - Blank line as event terminator.

    Call :meth:`feed` for each raw byte chunk (yields completed events), then
    :meth:`flush` once at end of stream (yields a trailing event that lacked a
    final blank line — rare but valid).
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._data_lines: list[str] = []

    def feed(self, chunk: bytes) -> Iterator[ResponseEvent]:
        self._buffer += chunk.decode("utf-8", errors="replace")
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            line = line.rstrip("\r")

            if line == "":
                yield from self._dispatch()
                continue
            if line.startswith(":"):
                continue  # comment / heartbeat
            if line.startswith(_DATA_PREFIX):
                self._data_lines.append(line[len(_DATA_PREFIX):])
            elif line.startswith(_DATA_PREFIX_TIGHT):
                self._data_lines.append(line[len(_DATA_PREFIX_TIGHT):])
            # We deliberately ignore `event:` / `id:` / `retry:` lines —
            # the payload's "type" field is authoritative.

    def flush(self) -> Iterator[ResponseEvent]:
        """Emit a trailing event buffered without a final blank line."""
        yield from self._dispatch()

    def _dispatch(self) -> Iterator[ResponseEvent]:
        if not self._data_lines:
            return
        payload = "\n".join(self._data_lines)
        self._data_lines = []
        if payload != "[DONE]":
            yield parse_event(payload)


def sse_iter_events(chunks: Iterable[bytes]) -> Iterator[ResponseEvent]:
    """Yield typed events parsed from an iterable of raw SSE byte chunks.

    Thin wrapper over :class:`SSEDecoder` that feeds the whole iterable to a
    single decoder, so buffering spans chunk boundaries correctly.
    """
    decoder = SSEDecoder()
    for chunk in chunks:
        yield from decoder.feed(chunk)
    yield from decoder.flush()
