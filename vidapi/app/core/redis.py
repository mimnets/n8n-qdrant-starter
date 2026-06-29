from __future__ import annotations

from arq.connections import ArqRedis, create_pool
from arq.connections import RedisSettings as ArqRedisSettings

from app.core.config import get_settings

_pool: ArqRedis | None = None


def _parse_redis_settings() -> ArqRedisSettings:
    settings = get_settings()
    return ArqRedisSettings.from_dsn(settings.redis_url)


async def create_arq_pool() -> ArqRedis:
    """Create and cache an ARQ Redis connection pool."""
    global _pool
    if _pool is not None:
        return _pool
    redis_settings = _parse_redis_settings()
    _pool = await create_pool(redis_settings)
    return _pool


async def get_arq_pool() -> ArqRedis:
    """Return the existing pool or create one."""
    if _pool is None:
        return await create_arq_pool()
    return _pool


async def close_arq_pool() -> None:
    """Close the ARQ Redis pool and release connections."""
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None


def get_redis_settings() -> ArqRedisSettings:
    """Return ARQ RedisSettings parsed from config (for worker startup)."""
    return _parse_redis_settings()
