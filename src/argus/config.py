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

    # API server
    api_host: str = "127.0.0.1"
    api_port: int = 8080

    # Optional Redis URL. When None, the in-process bus is used.
    redis_url: str | None = None

    # Filesystem path where uploaded PDFs are stored.
    storage_root: str = "./uploads"
    max_upload_bytes: int = 25 * 1024 * 1024

    # Comma-separated browser origins allowed to call the API. Keep local dev
    # working by default without exposing wildcard CORS in production.
    cors_allow_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    api_token: str = ""

    # Cheap LLM for pre-processing (atomizer, checkworthiness).
    # Defaults to DeepSeek; any OpenAI-compatible endpoint works.
    cheap_llm_api_key: str = Field(default="")
    cheap_llm_base_url: str = "https://api.deepseek.com"
    cheap_llm_model: str = "deepseek-chat"
    cheap_llm_timeout_s: float = 60.0

    # Per-job MiroMind spend cap (USD). A real 5-agent audit against
    # mirothinker-1-7-deepresearch ($4/$25 per M tokens) typically runs
    # $5-$50 depending on PDF size; default keeps us safely under that.
    job_budget_usd: float = 50.0


def settings() -> Settings:
    """Build a fresh Settings instance — tests can monkeypatch via env vars."""
    return Settings()
