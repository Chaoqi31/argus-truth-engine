"""Runtime configuration loaded from environment variables / .env."""
from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ARGUS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    miromind_api_key: str = Field(default="")
    miromind_base_url: str = "https://api.miromind.ai/v1"
    miromind_model: str = "mirothinker-1-7-deepresearch"
    miromind_request_timeout_s: float = 90.0
    miromind_stream_timeout_s: float = 300.0
    miromind_retry_attempts: int = 3
    miromind_retry_base_delay_s: float = 1.0
    db_url: str | None = None


def settings() -> Settings:
    """Build a fresh Settings instance — tests can monkeypatch via env vars."""
    return Settings()
