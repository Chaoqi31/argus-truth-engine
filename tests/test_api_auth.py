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


async def test_saved_api_key_can_be_renamed_made_default_and_tested(
    auth_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: dict[str, str] = {}

    class FakeMiroMindClient:
        def __init__(self, settings: Settings) -> None:
            calls["api_key"] = settings.miromind_api_key

        async def submit_background(self, **_kwargs: object) -> str:
            return "resp_test"

        async def cancel(self, response_id: str) -> None:
            calls["cancelled"] = response_id

    monkeypatch.setattr("argus.api.account.MiromindClient", FakeMiroMindClient)

    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        first = await client.post(
            "/me/api-keys",
            json={"api_key": "sk_first_1111", "label": "First"},
            headers={"Authorization": "Bearer user-a"},
        )
        second = await client.post(
            "/me/api-keys",
            json={"api_key": "sk_second_2222", "label": "Second"},
            headers={"Authorization": "Bearer user-a"},
        )
        assert first.status_code == 201
        assert second.status_code == 201

        patched = await client.patch(
            f"/me/api-keys/{first.json()['id']}",
            json={"label": "Research key", "make_default": True},
            headers={"Authorization": "Bearer user-a"},
        )
        tested = await client.post(
            "/me/api-keys/test",
            json={"key_id": first.json()["id"]},
            headers={"Authorization": "Bearer user-a"},
        )
        listed = await client.get(
            "/me/api-keys",
            headers={"Authorization": "Bearer user-a"},
        )

    assert patched.status_code == 200, patched.text
    assert patched.json()["label"] == "Research key"
    assert patched.json()["is_default"] is True
    assert tested.status_code == 200, tested.text
    assert tested.json()["ok"] is True
    assert calls == {"api_key": "sk_first_1111", "cancelled": "resp_test"}
    by_id = {item["id"]: item for item in listed.json()}
    assert by_id[first.json()["id"]]["is_default"] is True
    assert by_id[second.json()["id"]]["is_default"] is False


async def test_owner_can_delete_job_but_stranger_cannot(auth_app: FastAPI) -> None:
    repo = auth_app.state.argus.repo
    assert repo is not None
    await repo.upsert_user(AuthUser(id="u_a", email="a@example.com"))
    await repo.upsert_user(AuthUser(id="u_b", email="b@example.com"))
    await repo.save_job(Job(id="job_a", status="done", input_mode="text"), owner_user_id="u_a")
    await repo.save_job(Job(id="job_b", status="done", input_mode="text"), owner_user_id="u_b")

    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        stranger = await client.delete(
            "/jobs/job_a",
            headers={"Authorization": "Bearer user-b"},
        )
        owner = await client.delete(
            "/jobs/job_a",
            headers={"Authorization": "Bearer user-a"},
        )
        missing = await client.get(
            "/jobs/job_a",
            headers={"Authorization": "Bearer user-a"},
        )
        other = await client.get(
            "/jobs/job_b",
            headers={"Authorization": "Bearer user-b"},
        )

    assert stranger.status_code == 404
    assert owner.status_code == 204
    assert missing.status_code == 404
    assert other.status_code == 200


async def test_private_job_can_be_shared_and_revoked(auth_app: FastAPI) -> None:
    repo = auth_app.state.argus.repo
    assert repo is not None
    await repo.upsert_user(AuthUser(id="u_a", email="a@example.com"))
    await repo.save_job(
        Job(id="job_share", status="done", input_text="share me", input_mode="text"),
        owner_user_id="u_a",
    )

    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        created = await client.post(
            "/jobs/job_share/share",
            json={"expires_in_days": 7},
            headers={"Authorization": "Bearer user-a"},
        )
        assert created.status_code == 201, created.text
        token = created.json()["token"]

        public = await client.get(f"/share/{token}")
        history = await client.get(
            "/jobs",
            headers={"Authorization": "Bearer user-a"},
        )
        revoked = await client.delete(
            f"/jobs/job_share/share/{token}",
            headers={"Authorization": "Bearer user-a"},
        )
        public_after_revoke = await client.get(f"/share/{token}")

    assert public.status_code == 200, public.text
    assert public.json()["id"] == "job_share"
    assert history.status_code == 200, history.text
    assert history.json()["jobs"][0]["share_links"][0]["token"] == token
    assert revoked.status_code == 204
    assert public_after_revoke.status_code == 404


async def test_text_job_can_be_rerun_from_history(
    auth_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = auth_app.state.argus.repo
    assert repo is not None
    await repo.upsert_user(AuthUser(id="u_a", email="a@example.com"))
    await repo.save_job(
        Job(
            id="job_text",
            status="done",
            input_text="This is a sufficiently long previous text audit to rerun.",
            input_mode="text",
            content_domain="legal",
        ),
        owner_user_id="u_a",
    )
    captured: dict[str, object] = {}

    async def fake_submit_text(self: object, **kwargs: object) -> str:
        captured.update(kwargs)
        return "job_new"

    monkeypatch.setattr("argus.api.runner.JobRunner.submit_text", fake_submit_text)

    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        resp = await client.post(
            "/jobs/job_text/rerun",
            headers={"Authorization": "Bearer user-a"},
        )

    assert resp.status_code == 202, resp.text
    assert resp.json()["job_id"] == "job_new"
    assert captured["text"] == "This is a sufficiently long previous text audit to rerun."
    assert captured["content_domain"] == "legal"
    assert captured["owner_user_id"] == "u_a"


async def test_account_events_and_deletion_remove_user_data(auth_app: FastAPI) -> None:
    repo = auth_app.state.argus.repo
    assert repo is not None
    await repo.upsert_user(AuthUser(id="u_a", email="a@example.com"))
    await repo.save_job(
        Job(id="job_delete_me", status="done", input_mode="text"),
        owner_user_id="u_a",
    )

    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as client:
        event = await client.post(
            "/events",
            json={
                "event_name": "first_audit_started",
                "path": "/audit",
                "properties": {"mode": "text"},
            },
            headers={"Authorization": "Bearer user-a"},
        )
        deleted = await client.delete("/me", headers={"Authorization": "Bearer user-a"})
        history = await client.get("/jobs", headers={"Authorization": "Bearer user-a"})

    assert event.status_code == 202, event.text
    assert deleted.status_code == 204
    assert history.status_code == 200
    assert history.json()["jobs"] == []
