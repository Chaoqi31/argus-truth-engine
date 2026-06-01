"""Reconnection behaviour for MiromindClient.stream (resumable SSE streams).

Backs the README's "resumable SSE streams" claim. The real logic lives in
``MiromindClient.stream`` (the reconnect loop) + ``MiromindClient._stream_once``
(the GET + ``aiter_raw`` body iteration) + ``SSEDecoder`` (chunk → event), all
of which run unmodified here — only the network transport is faked.

Real semantics under test (read from src/argus/miromind/client.py):
  * ``stream(response_id, *, after=0, max_reconnects=3)`` resumes a dropped SSE
    connection by re-issuing ``GET /v1/responses/{id}?stream=true&after=<seq>``
    where ``<seq>`` is the highest ``sequence_number`` yielded so far.
  * Reconnect triggers: ``httpx.RemoteProtocolError``, ``httpx.ReadError``,
    ``httpx.ReadTimeout`` (and only those).
  * Bound: at most ``max_reconnects`` reconnects; the next failure re-raises.
  * Terminal events ``response.completed`` / ``response.failed`` end the loop.

We inject failures *mid-stream* (after N events are yielded) — which respx's
return-a-whole-Response model cannot express — by handing httpx a custom
``AsyncByteStream`` whose iterator raises after emitting some chunks, served via
``httpx.MockTransport`` and threaded into the client's internally-constructed
``httpx.AsyncClient``.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest

from argus.config import Settings
from argus.miromind.client import MiromindClient
from argus.models.miromind import ResponseEvent

# --- SSE byte fixtures -------------------------------------------------------


def _event_bytes(seq: int, *, type_: str = "response.in_progress") -> bytes:
    """A single complete SSE event frame (data line + blank-line terminator)."""
    return (
        b'data: {"type":"' + type_.encode() + b'",'
        b'"sequence_number":' + str(seq).encode() + b"}\n\n"
    )


def _completed_bytes(seq: int) -> bytes:
    return (
        b'data: {"type":"response.completed",'
        b'"sequence_number":' + str(seq).encode() + b","
        b'"response":{"id":"resp_x","status":"completed"}}\n\n'
    )


class _ScriptedByteStream(httpx.AsyncByteStream):
    """Yields a list of raw chunks, then optionally raises mid-stream.

    Models a server that streamed some events and then dropped the connection
    (when ``raise_exc`` is set) — the exception surfaces through
    ``resp.aiter_raw()`` exactly as a live transport-level drop would.
    """

    def __init__(self, chunks: list[bytes], raise_exc: BaseException | None = None) -> None:
        self._chunks = chunks
        self._raise = raise_exc

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk
        if self._raise is not None:
            raise self._raise

    async def aclose(self) -> None:  # pragma: no cover - nothing to release
        return None


def _sse_response(stream: _ScriptedByteStream) -> httpx.Response:
    return httpx.Response(
        200, stream=stream, headers={"content-type": "text/event-stream"}
    )


# --- transport injection -----------------------------------------------------


def _install_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    """Route every ``httpx.AsyncClient`` built inside the client through a mock.

    The client constructs its own ``httpx.AsyncClient(timeout=...)`` in
    ``_stream_once`` via ``import httpx``. Patching ``httpx.AsyncClient`` on the
    shared module object (the same object the client looks the name up on) with
    a factory injects a ``MockTransport`` while preserving the real class (and
    its kwargs, e.g. ``timeout``) for everything else.
    """
    transport = httpx.MockTransport(handler)
    real_cls = httpx.AsyncClient

    def factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = transport
        return real_cls(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)


def _client() -> MiromindClient:
    return MiromindClient(Settings(miromind_api_key="sk_live_x"))


async def _collect(stream: AsyncIterator[ResponseEvent]) -> list[ResponseEvent]:
    return [ev async for ev in stream]


# --- tests -------------------------------------------------------------------


async def test_reconnects_after_mid_stream_drop_and_delivers_full_sequence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """RemoteProtocolError after 2 events → reconnect, gap-free [1,2,3,4]."""
    afters: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        after = int(request.url.params["after"])
        afters.append(after)
        if after == 0:
            # First leg: deliver seq 1 and 2, then the connection drops.
            return _sse_response(
                _ScriptedByteStream(
                    [_event_bytes(1), _event_bytes(2)],
                    httpx.RemoteProtocolError("peer dropped"),
                )
            )
        # Resume leg (after=2): deliver the remaining events to completion.
        return _sse_response(
            _ScriptedByteStream([_event_bytes(3), _completed_bytes(4)])
        )

    _install_transport(monkeypatch, handler)

    events = await _collect(_client().stream("resp_x", after=0))

    # (a) full, gap-free sequence reaches the caller across the reconnect
    assert [e.sequence_number for e in events] == [1, 2, 3, 4]
    assert [e.type for e in events] == [
        "response.in_progress",
        "response.in_progress",
        "response.in_progress",
        "response.completed",
    ]
    # (b) reconnect resumed from the last delivered sequence number (cursor),
    #     not from 0 — so no events are re-fetched or duplicated.
    assert afters == [0, 2]


async def test_reconnects_on_read_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """ReadError shares the reconnect path with RemoteProtocolError."""
    afters: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        after = int(request.url.params["after"])
        afters.append(after)
        if after == 0:
            return _sse_response(
                _ScriptedByteStream(
                    [_event_bytes(1)], httpx.ReadError("connection reset")
                )
            )
        return _sse_response(_ScriptedByteStream([_completed_bytes(2)]))

    _install_transport(monkeypatch, handler)

    events = await _collect(_client().stream("resp_x", after=0))

    assert [e.sequence_number for e in events] == [1, 2]
    assert events[-1].type == "response.completed"
    assert afters == [0, 1]


async def test_reconnects_on_read_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """ReadTimeout also triggers a reconnect (third caught exception type)."""
    afters: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        after = int(request.url.params["after"])
        afters.append(after)
        if after == 0:
            return _sse_response(
                _ScriptedByteStream(
                    [_event_bytes(1)], httpx.ReadTimeout("read timed out")
                )
            )
        return _sse_response(_ScriptedByteStream([_completed_bytes(2)]))

    _install_transport(monkeypatch, handler)

    events = await _collect(_client().stream("resp_x", after=0))

    assert [e.sequence_number for e in events] == [1, 2]
    assert afters == [0, 1]


async def test_reconnects_are_bounded_and_reraise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A connection that always drops is retried at most max_reconnects times,
    then the error surfaces — the loop is bounded, never infinite."""
    attempts: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(int(request.url.params["after"]))
        # Every leg yields one event then drops — recovery never completes.
        return _sse_response(
            _ScriptedByteStream(
                [_event_bytes(len(attempts))],
                httpx.RemoteProtocolError("peer dropped again"),
            )
        )

    _install_transport(monkeypatch, handler)

    collected: list[ResponseEvent] = []
    with pytest.raises(httpx.RemoteProtocolError):
        async for ev in _client().stream("resp_x", after=0, max_reconnects=2):
            collected.append(ev)

    # 1 initial connection + exactly max_reconnects (2) retries = 3 total.
    assert len(attempts) == 3
    # Each leg delivered its one event before dropping, so the caller still
    # received the partial stream (1 per leg) before the final re-raise.
    assert [e.sequence_number for e in collected] == [1, 2, 3]


async def test_terminal_failed_event_stops_without_reconnect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A clean response.failed terminal event ends the stream — no reconnect."""
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(int(request.url.params["after"]))
        body = (
            _event_bytes(1)
            + b'data: {"type":"response.failed","sequence_number":2,'
            b'"response":{"id":"resp_x","status":"failed"}}\n\n'
        )
        return _sse_response(_ScriptedByteStream([body]))

    _install_transport(monkeypatch, handler)

    events = await _collect(_client().stream("resp_x", after=0))

    assert [e.type for e in events] == ["response.in_progress", "response.failed"]
    # Terminal event reached → exactly one connection, no reconnect attempt.
    assert calls == [0]
