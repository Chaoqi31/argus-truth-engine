"""Finding cache — persistent layer reads `finding_cache` table.

Round-trip: serialize Finding + Evidence list as JSON, key by claim+domain+version.
TTL enforced on read (lazy expiry; periodic GC tracked as separate follow-up).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from argus.db.models import FindingCacheRow
from argus.log import log
from argus.models.domain import Evidence, Finding


class FindingCache:
    def __init__(
        self,
        sessionmaker: async_sessionmaker,
        *,
        default_ttl_days: int = 30,
        time_sensitive_ttl_days: int = 3,
    ) -> None:
        self._sm = sessionmaker
        self._default_ttl = timedelta(days=default_ttl_days)
        self._time_sensitive_ttl = timedelta(days=time_sensitive_ttl_days)

    async def get(self, key: str) -> tuple[Finding, list[Evidence]] | None:
        """Lookup. Returns (Finding, evidences) or None on miss/expired."""
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
            payload = json.loads(row.payload) if isinstance(row.payload, str) else row.payload
            finding = Finding.model_validate(payload["finding"])
            evidences = [Evidence.model_validate(e) for e in payload["evidences"]]
            log.info("cache.hit", key=key[:12], hits=row.hit_count + 1)
            return finding, evidences

    async def put(
        self,
        key: str,
        *,
        finding: Finding,
        evidences: list[Evidence],
        verifier_version: str,
        content_domain: str,
        time_sensitive: bool = False,
    ) -> None:
        ttl = self._time_sensitive_ttl if time_sensitive else self._default_ttl
        payload = {
            "finding": finding.model_dump(mode="json"),
            "evidences": [e.model_dump(mode="json") for e in evidences],
        }
        async with self._sm() as session:
            # Upsert pattern: delete + insert (portable across SQLite & Postgres)
            await session.execute(
                delete(FindingCacheRow).where(FindingCacheRow.key == key)
            )
            session.add(FindingCacheRow(
                key=key,
                payload=json.dumps(payload),
                verifier_version=verifier_version,
                content_domain=content_domain,
                hit_count=0,
                created_at=datetime.utcnow(),
                expires_at=datetime.utcnow() + ttl,
            ))
            await session.commit()
            log.info("cache.put", key=key[:12], domain=content_domain, ttl_days=ttl.days)

    async def clear(self) -> int:
        """Admin: drop all cache rows. Returns count cleared."""
        async with self._sm() as session:
            result = await session.execute(delete(FindingCacheRow))
            await session.commit()
            return result.rowcount or 0
