"""Runtime model defaults and explicit operator overrides."""

from __future__ import annotations

from pathlib import Path

import pytest

from argus.config import Settings
from argus.llm.miromind import MiroMindAccess


def test_default_model_matches_the_documented_mini_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ARGUS_MIROMIND_MODEL", raising=False)
    settings = Settings(_env_file=None)

    assert settings.miromind_model == "mirothinker-1-7-deepresearch-mini"
    assert MiroMindAccess.from_settings(settings).model == settings.miromind_model


def test_environment_can_select_the_full_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARGUS_MIROMIND_MODEL", "mirothinker-1-7-deepresearch")

    assert Settings(_env_file=None).miromind_model == "mirothinker-1-7-deepresearch"


def test_explicit_model_overrides_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARGUS_MIROMIND_MODEL", "mirothinker-1-7-deepresearch")
    settings = Settings(_env_file=None, miromind_model="mirothinker-1-7-deepresearch-mini")

    assert settings.miromind_model == "mirothinker-1-7-deepresearch-mini"


def test_env_file_can_select_the_full_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("ARGUS_MIROMIND_MODEL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("ARGUS_MIROMIND_MODEL=mirothinker-1-7-deepresearch\n", encoding="utf-8")

    assert Settings(_env_file=env_file).miromind_model == "mirothinker-1-7-deepresearch"
