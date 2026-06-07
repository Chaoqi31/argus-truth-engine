from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from argus.api.app import create_app
from argus.api.auth import AuthUser
from argus.config import Settings
from argus.db.models import Base
from argus.models.domain import Job


class FakeVerifier:
    async def verify(self, token: str) -> AuthUser:
        if token == "user-a":
            return AuthUser(id="u_a", email="a@example.com", name="User A")
        if token == "user-b":
            return AuthUser(id="u_b", email="b@example.com", name="User B")
        raise AssertionError(f"unexpected token {token}")


@pytest.fixture
async def auth_app(tmp_path: Path) -> FastAPI:
    app = create_app(
        settings=Settings(
            auth_required=True,
            supabase_url="https://project.supabase.co",
            api_key_encryption_secret="test-secret",
            miromind_api_key="sk_server",
            db_url=f"sqlite+aiosqlite:///{tmp_path / 'auth.db'}",
            redis_url=None,
            storage_root=str(tmp_path / "uploads"),
        )
    )
    app.state.argus.auth_verifier = FakeVerifier()
    assert app.state.argus.db_engine is not None
    async with app.state.argus.db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return app


async def test_private_job_is_only_visible_to_owner(auth_app: FastAPI) -> None:
    repo = auth_app.state.argus.repo
    assert repo is not None
    await repo.upsert_user(AuthUser(id="u_a", email="a@example.com"))
    await repo.upsert_user(AuthUser(id="u_b", email="b@example.com"))
    await repo.save_job(
        Job(id="job_private", status="done", input_text="owned text", input_mode="text"),
        owner_user_id="u_a",
    )

    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        owner = await client.get(
            "/jobs/job_private",
            headers={"Authorization": "Bearer user-a"},
        )
        stranger = await client.get(
            "/jobs/job_private",
            headers={"Authorization": "Bearer user-b"},
        )
        anonymous = await client.get("/jobs/job_private")

    assert owner.status_code == 200
    assert owner.json()["id"] == "job_private"
    assert stranger.status_code == 404
    assert anonymous.status_code == 401


async def test_job_history_lists_only_current_user(auth_app: FastAPI) -> None:
    repo = auth_app.state.argus.repo
    assert repo is not None
    await repo.upsert_user(AuthUser(id="u_a", email="a@example.com"))
    await repo.upsert_user(AuthUser(id="u_b", email="b@example.com"))
    await repo.save_job(Job(id="job_a", status="done", input_mode="text"), owner_user_id="u_a")
    await repo.save_job(Job(id="job_b", status="done", input_mode="text"), owner_user_id="u_b")

    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        resp = await client.get("/jobs", headers={"Authorization": "Bearer user-a"})

    assert resp.status_code == 200
    assert [item["id"] for item in resp.json()["jobs"]] == ["job_a"]


async def test_saved_api_key_is_encrypted_and_not_returned(auth_app: FastAPI) -> None:
    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        created = await client.post(
            "/me/api-keys",
            json={"api_key": "sk_live_secret_1234", "label": "Personal key"},
            headers={"Authorization": "Bearer user-a"},
        )
        listed = await client.get(
            "/me/api-keys",
            headers={"Authorization": "Bearer user-a"},
        )

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["label"] == "Personal key"
    assert body["last4"] == "1234"
    assert "sk_live_secret" not in created.text
    assert listed.status_code == 200
    assert "sk_live_secret" not in listed.text


async def test_submit_text_can_use_default_saved_key(
    auth_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_audit_text(**kw: Any) -> Job:
        captured["api_key"] = kw["settings"].miromind_api_key
        return Job(id=kw["job_id"], status="done", input_text=kw["text"], input_mode="text")

    monkeypatch.setattr("argus.api.runner.audit_text", fake_audit_text)

    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        key_resp = await client.post(
            "/me/api-keys",
            json={"api_key": "sk_saved_secret_9999", "label": "Saved"},
            headers={"Authorization": "Bearer user-a"},
        )
        assert key_resp.status_code == 201, key_resp.text
        submit = await client.post(
            "/jobs/text",
            json={"text": "This is a sufficiently long text input for a saved-key audit."},
            headers={"Authorization": "Bearer user-a"},
        )
        assert submit.status_code == 202, submit.text

    for _ in range(20):
        if "api_key" in captured:
            break
        await asyncio.sleep(0.05)
    assert captured["api_key"] == "sk_saved_secret_9999"
