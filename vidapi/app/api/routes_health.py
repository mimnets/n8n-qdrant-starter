from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import DBSessionDep, SettingsDep

router = APIRouter(tags=["health"])

_REDIS_PING_TIMEOUT_SECONDS = 2.0


async def _check_db(session: DBSessionDep) -> dict[str, str]:
    try:
        await session.execute(text("SELECT 1"))
        return {"status": "healthy"}
    except Exception as exc:
        return {"status": "unhealthy", "error": str(exc)}


async def _check_redis(settings: SettingsDep) -> dict[str, str]:
    """Ping Redis with a bounded timeout. Returns status dict."""
    if settings.render_mode != "async":
        return {"status": "skipped", "reason": "sync mode"}

    try:
        from app.core.redis import get_arq_pool

        pool = await get_arq_pool()
        pong: bool = await asyncio.wait_for(
            pool.ping(), timeout=_REDIS_PING_TIMEOUT_SECONDS
        )
        if pong:
            return {"status": "healthy"}
        return {"status": "unhealthy", "error": "ping returned false"}
    except TimeoutError:
        return {"status": "unhealthy", "error": "ping timeout"}
    except Exception as exc:
        return {"status": "unhealthy", "error": str(exc)}


@router.get("/health")
async def health_check(settings: SettingsDep, session: DBSessionDep) -> dict[str, Any]:
    db_status = await _check_db(session)
    redis_status = await _check_redis(settings)

    all_healthy = db_status["status"] == "healthy"
    if redis_status["status"] not in ("healthy", "skipped"):
        all_healthy = False

    overall = "healthy" if all_healthy else "degraded"
    return {
        "status": overall,
        "service": settings.app_name,
        "version": settings.app_version,
        "database": db_status,
        "redis": redis_status,
        "timestamp": datetime.now(UTC).isoformat(),
    }
