"""Object storage abstractions for uploaded PDFs and exports."""

from argus.storage.base import Storage
from argus.storage.local_fs import LocalFsStorage

__all__ = ["LocalFsStorage", "Storage"]
