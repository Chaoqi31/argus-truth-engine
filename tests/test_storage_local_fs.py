"""Tests for LocalFsStorage."""
from __future__ import annotations

from pathlib import Path

import pytest

from argus.storage.local_fs import LocalFsStorage


async def test_put_and_get_round_trip(tmp_path: Path) -> None:
    s = LocalFsStorage(root=tmp_path)
    blob = b"%PDF-1.4\nhello\n"
    key = await s.put("job-abc/report.pdf", blob, content_type="application/pdf")
    assert key == "job-abc/report.pdf"

    out = await s.get(key)
    assert out == blob


async def test_put_creates_nested_dirs(tmp_path: Path) -> None:
    s = LocalFsStorage(root=tmp_path)
    await s.put("a/b/c/x.pdf", b"x")
    assert (tmp_path / "a" / "b" / "c" / "x.pdf").exists()


async def test_get_missing_raises(tmp_path: Path) -> None:
    s = LocalFsStorage(root=tmp_path)
    with pytest.raises(FileNotFoundError):
        await s.get("nope.pdf")


async def test_path_for_returns_filesystem_path(tmp_path: Path) -> None:
    s = LocalFsStorage(root=tmp_path)
    await s.put("x.pdf", b"x")
    p = s.path_for("x.pdf")
    assert p.exists()
    assert p.is_relative_to(tmp_path)


async def test_rejects_sibling_path_with_same_prefix(tmp_path: Path) -> None:
    s = LocalFsStorage(root=tmp_path / "uploads")

    with pytest.raises(ValueError, match="escapes storage root"):
        await s.put("../uploads_evil/x.pdf", b"x")
