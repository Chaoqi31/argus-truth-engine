"""The one JSON output contract for every LLM task, whichever provider answered."""

from __future__ import annotations

import json

import json_repair
from pydantic import BaseModel, ValidationError


class OutputError(ValueError):
    """The text could not be turned into the task's output model."""


def parse_output[T: BaseModel](text: str, model: type[T]) -> T:
    """Parse model output into ``model``, repairing the damage LLMs commonly do.

    Strips a surrounding code fence, cuts to the outermost ``{...}``, repairs
    broken JSON (missing quotes or commas, trailing commas) and unwraps a
    single-element array. Raises `OutputError` with the reason, which
    `repair_prompt` feeds back to the model.
    """
    try:
        return model.model_validate_json(_json_object(text))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise OutputError(str(exc)) from exc


def repair_prompt(prompt: str, error: OutputError) -> str:
    return (
        f"{prompt}\n\n---\n"
        "Your previous output failed JSON validation with this error:\n"
        f"{error}\n"
        "Please re-emit ONLY a valid JSON object matching the required schema. "
        "Do not include any prose, code fences, or commentary."
    )


def _json_object(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        first = text.find("\n", 3)
        last = text.rfind("```")
        if first != -1 and last > first:
            text = text[first + 1 : last].strip()
    if "{" in text and "}" in text:
        text = text[text.find("{") : text.rfind("}") + 1]
    try:
        json.loads(text)
    except json.JSONDecodeError:
        repaired = json_repair.repair_json(text)
        if not isinstance(repaired, str) or repaired in ("", "{}", "[]", '""'):
            raise json.JSONDecodeError("json_repair could not recover", text, 0) from None
        text = repaired
    parsed = json.loads(text)
    if isinstance(parsed, list) and len(parsed) == 1 and isinstance(parsed[0], dict):
        return json.dumps(parsed[0], ensure_ascii=False)
    return text
