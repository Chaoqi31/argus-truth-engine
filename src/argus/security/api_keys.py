"""Encryption helpers for user-saved provider API keys."""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet


class ApiKeyCipher:
    def __init__(self, secret: str) -> None:
        if not secret.strip():
            raise ValueError("api key encryption secret is required")
        digest = hashlib.sha256(secret.encode("utf-8")).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(digest))

    def encrypt(self, api_key: str) -> str:
        return self._fernet.encrypt(api_key.encode("utf-8")).decode("ascii")

    def decrypt(self, encrypted_key: str) -> str:
        return self._fernet.decrypt(encrypted_key.encode("ascii")).decode("utf-8")

    @staticmethod
    def fingerprint(api_key: str) -> str:
        return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:32]

    @staticmethod
    def last4(api_key: str) -> str:
        compact = api_key.strip()
        return compact[-4:] if len(compact) >= 4 else compact
