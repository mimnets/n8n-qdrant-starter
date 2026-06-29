from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Iterable, Mapping
from typing import Any

SHA256_HEX_PATTERN = re.compile(r"^[0-9a-f]{64}$")
REDACTED_SECRET = "[REDACTED]"

_SECRET_KEY_NAMES = {
    "authorization",
    "x-api-key",
    "api-key",
    "api_key",
    "api key",
    "token",
    "secret",
    "password",
}
_SECRET_KEY_FRAGMENTS = ("api_key", "api-key", "token", "secret", "password")


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def normalize_configured_api_key_hashes(
    configured_hashes: Iterable[str],
) -> tuple[str, ...]:
    normalized: list[str] = []
    seen: set[str] = set()

    for configured_hash in configured_hashes:
        candidate = configured_hash.strip().lower()
        if not candidate:
            continue
        if SHA256_HEX_PATTERN.fullmatch(candidate) is None:
            msg = "API_KEY_HASHES entries must be 64-character SHA-256 hex digests"
            raise ValueError(msg)
        if candidate not in seen:
            normalized.append(candidate)
            seen.add(candidate)

    return tuple(normalized)


def validate_api_key(api_key: str, configured_hashes: Iterable[str]) -> bool:
    if not api_key.strip():
        return False

    normalized_hashes = normalize_configured_api_key_hashes(configured_hashes)
    if not normalized_hashes:
        return False

    presented_hash = hash_api_key(api_key)
    is_valid = False
    for configured_hash in normalized_hashes:
        is_valid = hmac.compare_digest(presented_hash, configured_hash) or is_valid
    return is_valid


def is_secret_key(key: str) -> bool:
    lowered = key.strip().lower()
    normalized = lowered.replace("_", "-")
    if lowered in _SECRET_KEY_NAMES or normalized in _SECRET_KEY_NAMES:
        return True
    return any(fragment in lowered for fragment in _SECRET_KEY_FRAGMENTS)


def redact_secret_values(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: REDACTED_SECRET
            if is_secret_key(str(key))
            else redact_secret_values(val)
            for key, val in value.items()
        }
    if isinstance(value, list):
        return [redact_secret_values(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_secret_values(item) for item in value)
    return value
