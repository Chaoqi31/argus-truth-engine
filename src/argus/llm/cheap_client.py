"""Lightweight async client for OpenAI-compatible chat completions.

Used for cheap pre-processing steps (claim atomization, checkworthiness
filtering) that don't need MiroMind's deep-research capabilities.
"""
from __future__ import annotations

import json
from typing import TypeVar

import httpx
import json_repair
from pydantic import BaseModel, ValidationError

from argus.log import log

T = TypeVar("T", bound=BaseModel)

_RETRY_LIMIT = 1


class CheapLLMClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.deepseek.com/v1",
        model: str = "deepseek-chat",
        timeout_s: float = 60.0,
    ) -> None:
        self._model = model
        self._http = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(timeout_s),
        )

    async def complete(
        self,
        system_prompt: str,
        user_input: str,
        model_cls: type[T],
        *,
        max_tokens: int = 4000,
    ) -> T:
        raw = await self._call(system_prompt, user_input, max_tokens)
        err_msg = ""
        try:
            return self._validate(raw, model_cls)
        except (ValidationError, json.JSONDecodeError) as first_err:
            err_msg = str(first_err)
            log.warning("cheap_llm.json_invalid", error=err_msg)

        repair_input = (
            f"{user_input}\n\n---\n"
            f"Your previous output failed JSON validation:\n{err_msg}\n"
            "Re-emit ONLY a valid JSON object matching the required schema."
        )
        raw2 = await self._call(system_prompt, repair_input, max_tokens)
        return self._validate(raw2, model_cls)

    async def _call(
        self, system: str, user: str, max_tokens: int
    ) -> str:
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
        resp = await self._http.post("/chat/completions", json=body)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    @staticmethod
    def _validate(text: str, model_cls: type[T]) -> T:
        text = text.strip()
        if text.startswith("```"):
            first = text.find("\n", 3)
            last = text.rfind("```")
            if first != -1 and last > first:
                text = text[first + 1 : last].strip()
        if "{" in text and "}" in text:
            start = text.find("{")
            end = text.rfind("}") + 1
            text = text[start:end]
        try:
            json.loads(text)
            return model_cls.model_validate_json(text)
        except (json.JSONDecodeError, ValidationError):
            repaired = json_repair.repair_json(text)
            if not repaired or repaired in ("{}", "[]", '""'):
                raise
            return model_cls.model_validate_json(repaired)

    async def close(self) -> None:
        await self._http.aclose()
