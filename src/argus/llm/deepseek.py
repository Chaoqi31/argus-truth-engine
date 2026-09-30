"""DeepSeek, or any OpenAI-compatible chat endpoint, as a transport.

One ``POST /chat/completions`` in JSON mode at temperature 0. The JSON
output contract and the repair round live in `argus.llm`, shared with MiroMind.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from argus.config import Settings


class DeepSeekError(Exception):
    """A failed request or a completion without a message."""


@dataclass(frozen=True)
class DeepSeekResponse:
    completion_id: str
    text: str
    total_tokens: int


class DeepSeek:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._url = f"{settings.cheap_llm_base_url}/chat/completions"
        self._headers = {"Authorization": f"Bearer {settings.cheap_llm_api_key}"}
        self._model = settings.cheap_llm_model
        self._timeout = settings.cheap_llm_timeout_s

    async def chat(self, *, system: str, user: str, max_tokens: int) -> DeepSeekResponse:
        body = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
        }
        try:
            resp = await self._http.post(
                self._url, json=body, headers=self._headers, timeout=self._timeout
            )
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
            text = str(data["choices"][0]["message"]["content"])
        except httpx.HTTPError as exc:
            raise DeepSeekError(str(exc)) from exc
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise DeepSeekError(f"malformed completion: {exc}") from exc
        return DeepSeekResponse(
            completion_id=str(data.get("id", "")),
            text=text,
            total_tokens=int((data.get("usage") or {}).get("total_tokens", 0)),
        )
