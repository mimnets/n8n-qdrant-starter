from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Security
from fastapi.security import APIKeyHeader

from app.api.errors import InvalidAPIKeyError, MissingAPIKeyError
from app.core.config import Settings, get_settings
from app.core.security import validate_api_key

API_KEY_HEADER_NAME = "X-API-Key"
API_KEY_SECURITY_SCHEME_NAME = "APIKeyAuth"

api_key_header = APIKeyHeader(
    name=API_KEY_HEADER_NAME,
    scheme_name=API_KEY_SECURITY_SCHEME_NAME,
    description="VidAPI API key supplied through the X-API-Key header.",
    auto_error=False,
)


async def require_api_key(
    api_key: Annotated[str | None, Security(api_key_header)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    if not settings.api_key_auth_enabled:
        return

    if api_key is None or not api_key.strip():
        raise MissingAPIKeyError()

    if not validate_api_key(api_key, settings.api_key_hashes):
        raise InvalidAPIKeyError()
