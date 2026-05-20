"""Local-filesystem implementation of Storage."""
from __future__ import annotations

from pathlib import Path

import aiofiles


class LocalFsStorage:
    def __init__(self, root: Path | str) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    async def put(
        self, key: str, blob: bytes, *, content_type: str | None = None
    ) -> str:
        path = self._safe_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(path, "wb") as fh:
            await fh.write(blob)
        return key

    async def get(self, key: str) -> bytes:
        path = self._safe_path(key)
        if not path.exists():
            raise FileNotFoundError(key)
        async with aiofiles.open(path, "rb") as fh:
            data: bytes = await fh.read()
            return data

    def path_for(self, key: str) -> Path:
        return self._safe_path(key)

    def _safe_path(self, key: str) -> Path:
        """Prevent path traversal — keys must stay under root."""
        p = (self._root / key).resolve()
        root_resolved = self._root.resolve()
        if not str(p).startswith(str(root_resolved)):
            raise ValueError(f"key escapes storage root: {key!r}")
        return p
