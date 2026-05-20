"""Storage protocol — minimal async key→bytes interface."""
from __future__ import annotations

from pathlib import Path
from typing import Protocol


class Storage(Protocol):
    async def put(
        self, key: str, blob: bytes, *, content_type: str | None = None
    ) -> str:
        """Write the blob; return the storage key."""
        ...

    async def get(self, key: str) -> bytes:
        """Read the blob. Raises FileNotFoundError if absent."""
        ...

    def path_for(self, key: str) -> Path:
        """Return a filesystem path for the key (LocalFs only).

        Convenience for callers that need an on-disk path for libraries like
        pdfplumber that don't accept bytes.
        """
        ...
