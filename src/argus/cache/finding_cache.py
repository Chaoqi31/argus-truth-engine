"""Verdict cache: verifier verdicts reused across jobs, in `finding_cache`.

Keyed by normalized claim text, content domain and verifier version. A hit
brings the evidence and the trace the verdict rests on, so the job that
reuses it can show its research. TTL enforced on read (lazy expiry).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from argus.db.models import FindingCacheRow
from argus.log import log
from argus.models.domain import Evidence, Finding, Frozen, ReasoningTrace, Usage, new_id


class CachedVerdict(Frozen):
    """A verifier finding with the evidence it cites and the trace behind it."""

    finding: Finding
    evidences: tuple[Evidence, ...]
    trace: ReasoningTrace

    def for_claim(self, claim_id: str) -> CachedVerdict:
        """This verdict under fresh ids, bound to ``claim_id`` in another job.
        The trace keeps its response ids, which name the research, and costs
        nothing: the job that reuses it did not pay for it."""
        steps = {step.id: new_id("step") for step in self.trace.steps}
        trace = self.trace.model_copy(
            update={
                "id": new_id("trace"),
                "claim_id": claim_id,
                "usage": Usage(response_ids=self.trace.usage.response_ids),
                "steps": tuple(
                    step.model_copy(update={"id": steps[step.id]}) for step in self.trace.steps
                ),
            }
        )
        evidences = {
            evidence.id: evidence.model_copy(
                update={
                    "id": new_id("ev"),
                    "retrieved_by_step_id": steps.get(
                        evidence.retrieved_by_step_id, evidence.retrieved_by_step_id
                    ),
                }
            )
            for evidence in self.evidences
        }
        finding = self.finding.model_copy(
            update={
                "id": new_id("f"),
                "claim_id": claim_id,
                "evidence_ids": tuple(evidences[i].id for i in self.finding.evidence_ids),
                "reasoning_trace_id": trace.id,
                "from_cache": True,
            }
        )
        return CachedVerdict(finding=finding, evidences=tuple(evidences.values()), trace=trace)


class FindingCache:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        *,
        default_ttl_days: int = 30,
        time_sensitive_ttl_days: int = 3,
    ) -> None:
        self._sm = sessionmaker
        self._default_ttl = timedelta(days=default_ttl_days)
        self._time_sensitive_ttl = timedelta(days=time_sensitive_ttl_days)

    async def get(self, key: str) -> CachedVerdict | None:
        """The cached verdict, or None on a miss or an expired entry."""
        async with self._sm() as session:
            row = await session.scalar(
                select(FindingCacheRow).where(FindingCacheRow.key == key)
            )
            if row is None:
                return None
            if row.expires_at < datetime.utcnow():
                log.info("cache.miss_expired", key=key[:12])
                return None
            await session.execute(
                update(FindingCacheRow)
                .where(FindingCacheRow.key == key)
                .values(hit_count=FindingCacheRow.hit_count + 1)
            )
            await session.commit()
            log.info("cache.hit", key=key[:12], hits=row.hit_count + 1)
            return CachedVerdict.model_validate(row.payload)

    async def put(
        self,
        key: str,
        verdict: CachedVerdict,
        *,
        verifier_version: str,
        content_domain: str,
        time_sensitive: bool = False,
    ) -> None:
        ttl = self._time_sensitive_ttl if time_sensitive else self._default_ttl
        async with self._sm() as session:
            # Upsert pattern: delete + insert (portable across SQLite & Postgres).
            # Under concurrent puts of the same key, two writers can both pass
            # the delete and race on the insert. On Postgres this surfaces as
            # IntegrityError (unique violation on the PK). Since this is a
            # best-effort cache, the loser silently drops its write — the
            # winner's payload is just as valid (same verifier_version, same
            # claim text → same verdict).
            await session.execute(
                delete(FindingCacheRow).where(FindingCacheRow.key == key)
            )
            session.add(FindingCacheRow(
                key=key,
                payload=verdict.model_dump(mode="json"),
                verifier_version=verifier_version,
                content_domain=content_domain,
                hit_count=0,
                created_at=datetime.utcnow(),
                expires_at=datetime.utcnow() + ttl,
            ))
            try:
                await session.commit()
                log.info("cache.put", key=key[:12], domain=content_domain,
                         ttl_days=ttl.days)
            except IntegrityError:
                await session.rollback()
                log.info("cache.put_lost_race", key=key[:12])
