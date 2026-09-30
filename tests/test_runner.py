"""The API's runner: what a client can drive a job through, and when."""
from __future__ import annotations

import asyncio
from datetime import datetime

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.api.runner import JobBusy, Runner
from argus.audit import Run
from argus.config import Settings
from argus.db.repository import JobRepository
from argus.llm import Transports
from argus.llm.miromind import MiroMindAccess
from argus.models.domain import Claim, ClaimType
from argus.models.job import ClaimsSelected, Finished, Job, ReviewReady


def _claim(cid: str) -> Claim:
    return Claim(
        id=cid, text=f"claim {cid}", span=(0, 5), type=ClaimType.CITATION, importance="high"
    )


@pytest.fixture
def settings() -> Settings:
    return Settings(miromind_api_key="fake", cache_enabled=False)


def _runner(sqlite_engine: object, settings: Settings) -> Runner:
    repo = JobRepository(async_sessionmaker(sqlite_engine, expire_on_commit=False))
    return Runner(repo=repo, transports=Transports(settings), settings=settings)


def _access(settings: Settings) -> MiroMindAccess:
    return MiroMindAccess(api_key=SecretStr("fake"), model=settings.miromind_model)


async def test_select_waits_for_a_paused_run_to_store_its_job(
    sqlite_engine: object, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The `review_ready` frame reaches the client before the paused job is
    written, so a reviewer who answers at once must wait rather than read the
    run's earlier state."""
    runner = _runner(sqlite_engine, settings)
    written = asyncio.Event()
    original_update = runner._repo.update_job

    async def delayed(job: Job) -> bool:
        await written.wait()
        return await original_update(job)

    async def pausing(run: Run) -> None:
        run.record(ReviewReady(claims=(_claim("c1"),)))

    monkeypatch.setattr(runner._repo, "update_job", delayed)
    monkeypatch.setattr("argus.api.runner._audit", pausing)
    monkeypatch.setattr("argus.api.runner.verify", lambda *_: asyncio.sleep(0))

    await runner.submit(
        Job(id="j1", input_mode="text", input_text="text"),
        access=_access(settings),
        owner_user_id=None,
    )
    async with asyncio.timeout(5):
        while (await runner.get("j1")).status != "awaiting_review":  # type: ignore[union-attr]
            await asyncio.sleep(0.01)

    selecting = asyncio.create_task(runner.select("j1", ["c1"], access=_access(settings)))
    await asyncio.sleep(0.05)
    assert not selecting.done(), "select read the job before the paused run stored it"

    written.set()
    await selecting


async def test_a_finished_frame_waits_until_the_job_is_stored(
    sqlite_engine: object, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Everything but the socket reads the stored job, so a client must not
    see a state the store does not have yet."""
    runner = _runner(sqlite_engine, settings)
    released = asyncio.Event()
    started = asyncio.Event()
    original_update = runner._repo.update_job

    async def delayed(job: Job) -> bool:
        await released.wait()
        return await original_update(job)

    async def finishing(run: Run) -> None:
        started.set()
        await released.wait()
        run.record(Finished(status="done", completed_at=datetime.utcnow()))

    monkeypatch.setattr(runner._repo, "update_job", delayed)
    monkeypatch.setattr("argus.api.runner._audit", finishing)

    await runner.submit(
        Job(id="j1", input_mode="text", input_text="text"),
        access=_access(settings),
        owner_user_id=None,
    )
    async with runner.subscribe("j1") as feed:
        await asyncio.wait_for(started.wait(), timeout=5)
        seen: list[tuple[str, str]] = []

        async def collect() -> None:
            async for frame in feed.frames():
                stored = await runner._repo.get_job("j1")
                seen.append((frame.event.type, stored.status if stored else "missing"))

        collecting = asyncio.create_task(collect())
        await asyncio.sleep(0.05)
        assert seen == [], "the finished frame arrived before the job was stored"

        released.set()
        async with asyncio.timeout(5):
            while not seen:
                await asyncio.sleep(0.01)
        collecting.cancel()

    assert seen == [("finished", "done")]


async def test_select_refuses_a_job_that_is_already_verifying(
    sqlite_engine: object, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner = _runner(sqlite_engine, settings)
    running = asyncio.Event()

    async def never_finishes(run: Run, claim_ids: object) -> None:
        run.record(ClaimsSelected(claim_ids=list(claim_ids)))  # type: ignore[arg-type]
        await running.wait()

    async def pausing(run: Run) -> None:
        run.record(ReviewReady(claims=(_claim("c1"),)))

    monkeypatch.setattr("argus.api.runner._audit", pausing)
    monkeypatch.setattr("argus.api.runner.verify", never_finishes)

    await runner.submit(
        Job(id="j1", input_mode="text", input_text="text"),
        access=_access(settings),
        owner_user_id=None,
    )
    async with asyncio.timeout(5):
        while (await runner.get("j1")).status != "awaiting_review":  # type: ignore[union-attr]
            await asyncio.sleep(0.01)
    await runner.select("j1", ["c1"], access=_access(settings))
    async with asyncio.timeout(5):
        while (await runner.get("j1")).status != "running":  # type: ignore[union-attr]
            await asyncio.sleep(0.01)

    with pytest.raises(JobBusy):
        await runner.select("j1", ["c1"], access=_access(settings))

    running.set()
    await runner.cancel("j1")
