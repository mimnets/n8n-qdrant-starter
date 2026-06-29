from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from app.db.models import Render  # noqa: F401 - registers table
from app.db.webhook_crud import (
    create_attempt,
    list_attempts_by_render_id,
    update_attempt_result,
)
from app.db.webhook_models import WebhookAttempt  # noqa: F401 - registers table


@pytest.fixture
async def db_session() -> AsyncIterator[SQLModelAsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite://", echo=False, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with SQLModelAsyncSession(engine) as session:
        yield session
    await engine.dispose()


class TestCreateAttempt:
    @pytest.mark.asyncio
    async def test_creates_attempt_with_all_fields(
        self, db_session: SQLModelAsyncSession
    ) -> None:
        attempt = await create_attempt(
            db_session,
            render_id="render_abc",
            event="render.succeeded",
            url="https://example.com/hook",
            attempt_number=1,
        )

        assert attempt.id is not None
        assert attempt.render_id == "render_abc"
        assert attempt.event == "render.succeeded"
        assert attempt.url == "https://example.com/hook"
        assert attempt.attempt_number == 1
        assert attempt.status_code is None
        assert attempt.delivered_at is None
        assert attempt.error is None
        assert attempt.created_at is not None

    @pytest.mark.asyncio
    async def test_creates_with_custom_scheduled_at(
        self, db_session: SQLModelAsyncSession
    ) -> None:
        scheduled = datetime(2026, 5, 5, 10, 0, 0, tzinfo=UTC)
        attempt = await create_attempt(
            db_session,
            render_id="render_xyz",
            event="render.failed",
            url="https://example.com/fail",
            attempt_number=2,
            scheduled_at=scheduled,
        )

        assert attempt.scheduled_at.replace(tzinfo=None) == scheduled.replace(
            tzinfo=None
        )


class TestUpdateAttemptResult:
    @pytest.mark.asyncio
    async def test_updates_with_success(self, db_session: SQLModelAsyncSession) -> None:
        attempt = await create_attempt(
            db_session,
            render_id="render_upd",
            event="render.succeeded",
            url="https://example.com/hook",
            attempt_number=1,
        )

        updated = await update_attempt_result(
            db_session,
            attempt.id,
            status_code=200,
            response_body_excerpt="OK",
        )

        assert updated is not None
        assert updated.status_code == 200
        assert updated.response_body_excerpt == "OK"
        assert updated.delivered_at is not None
        assert updated.error is None

    @pytest.mark.asyncio
    async def test_updates_with_error(self, db_session: SQLModelAsyncSession) -> None:
        attempt = await create_attempt(
            db_session,
            render_id="render_err",
            event="render.failed",
            url="https://example.com/hook",
            attempt_number=1,
        )

        updated = await update_attempt_result(
            db_session,
            attempt.id,
            error="Connection refused",
        )

        assert updated is not None
        assert updated.error == "Connection refused"
        assert updated.status_code is None

    @pytest.mark.asyncio
    async def test_truncates_long_response(
        self, db_session: SQLModelAsyncSession
    ) -> None:
        attempt = await create_attempt(
            db_session,
            render_id="render_long",
            event="render.succeeded",
            url="https://example.com/hook",
            attempt_number=1,
        )

        long_body = "x" * 1000
        updated = await update_attempt_result(
            db_session,
            attempt.id,
            status_code=200,
            response_body_excerpt=long_body,
        )

        assert updated is not None
        assert len(updated.response_body_excerpt) == 500

    @pytest.mark.asyncio
    async def test_returns_none_for_missing_id(
        self, db_session: SQLModelAsyncSession
    ) -> None:
        result = await update_attempt_result(
            db_session,
            99999,
            status_code=200,
        )
        assert result is None


class TestListAttemptsByRenderId:
    @pytest.mark.asyncio
    async def test_lists_all_attempts_for_render(
        self, db_session: SQLModelAsyncSession
    ) -> None:
        for i in range(1, 4):
            await create_attempt(
                db_session,
                render_id="render_list",
                event="render.succeeded",
                url="https://example.com/hook",
                attempt_number=i,
            )

        attempts = await list_attempts_by_render_id(db_session, "render_list")

        assert len(attempts) == 3
        assert [a.attempt_number for a in attempts] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_returns_empty_for_unknown_render(
        self, db_session: SQLModelAsyncSession
    ) -> None:
        attempts = await list_attempts_by_render_id(db_session, "nonexistent")
        assert attempts == []

    @pytest.mark.asyncio
    async def test_does_not_mix_renders(self, db_session: SQLModelAsyncSession) -> None:
        await create_attempt(
            db_session,
            render_id="render_a",
            event="render.succeeded",
            url="https://example.com/a",
            attempt_number=1,
        )
        await create_attempt(
            db_session,
            render_id="render_b",
            event="render.failed",
            url="https://example.com/b",
            attempt_number=1,
        )

        attempts_a = await list_attempts_by_render_id(db_session, "render_a")
        attempts_b = await list_attempts_by_render_id(db_session, "render_b")

        assert len(attempts_a) == 1
        assert len(attempts_b) == 1
        assert attempts_a[0].render_id == "render_a"
        assert attempts_b[0].render_id == "render_b"
