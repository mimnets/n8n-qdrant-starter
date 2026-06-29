from __future__ import annotations

import pytest
from sqlmodel import select

from app.db.models import Render
from app.models.render import RenderStatus

# ---------------------------------------------------------------------------
# RenderStatus state machine
# ---------------------------------------------------------------------------


class TestRenderStatusTransitions:
    def test_queued_to_fetching(self) -> None:
        result = RenderStatus.QUEUED.transition_to(RenderStatus.FETCHING)
        assert result == RenderStatus.FETCHING

    def test_queued_to_cancelled(self) -> None:
        result = RenderStatus.QUEUED.transition_to(RenderStatus.CANCELLED)
        assert result == RenderStatus.CANCELLED

    def test_queued_to_failed(self) -> None:
        result = RenderStatus.QUEUED.transition_to(RenderStatus.FAILED)
        assert result == RenderStatus.FAILED

    def test_fetching_to_compiling(self) -> None:
        result = RenderStatus.FETCHING.transition_to(RenderStatus.COMPILING)
        assert result == RenderStatus.COMPILING

    def test_fetching_to_failed(self) -> None:
        result = RenderStatus.FETCHING.transition_to(RenderStatus.FAILED)
        assert result == RenderStatus.FAILED

    def test_compiling_to_rendering(self) -> None:
        result = RenderStatus.COMPILING.transition_to(RenderStatus.RENDERING)
        assert result == RenderStatus.RENDERING

    def test_rendering_to_uploading(self) -> None:
        result = RenderStatus.RENDERING.transition_to(RenderStatus.UPLOADING)
        assert result == RenderStatus.UPLOADING

    def test_uploading_to_succeeded(self) -> None:
        result = RenderStatus.UPLOADING.transition_to(RenderStatus.SUCCEEDED)
        assert result == RenderStatus.SUCCEEDED

    def test_happy_path_full_chain(self) -> None:
        status = RenderStatus.QUEUED
        for target in [
            RenderStatus.FETCHING,
            RenderStatus.COMPILING,
            RenderStatus.RENDERING,
            RenderStatus.UPLOADING,
            RenderStatus.SUCCEEDED,
        ]:
            status = status.transition_to(target)
        assert status == RenderStatus.SUCCEEDED

    def test_invalid_queued_to_rendering(self) -> None:
        with pytest.raises(ValueError, match="Invalid status transition"):
            RenderStatus.QUEUED.transition_to(RenderStatus.RENDERING)

    def test_invalid_succeeded_to_failed(self) -> None:
        with pytest.raises(ValueError, match="Invalid status transition"):
            RenderStatus.SUCCEEDED.transition_to(RenderStatus.FAILED)

    def test_invalid_failed_to_queued(self) -> None:
        with pytest.raises(ValueError, match="Invalid status transition"):
            RenderStatus.FAILED.transition_to(RenderStatus.QUEUED)

    def test_invalid_cancelled_to_queued(self) -> None:
        with pytest.raises(ValueError, match="Invalid status transition"):
            RenderStatus.CANCELLED.transition_to(RenderStatus.QUEUED)

    def test_terminal_states(self) -> None:
        assert RenderStatus.SUCCEEDED.is_terminal
        assert RenderStatus.FAILED.is_terminal
        assert RenderStatus.CANCELLED.is_terminal
        assert not RenderStatus.QUEUED.is_terminal
        assert not RenderStatus.RENDERING.is_terminal

    def test_can_transition_to(self) -> None:
        assert RenderStatus.QUEUED.can_transition_to(RenderStatus.FETCHING)
        assert not RenderStatus.QUEUED.can_transition_to(RenderStatus.UPLOADING)

    def test_all_8_statuses_exist(self) -> None:
        expected = {
            "queued",
            "fetching",
            "compiling",
            "rendering",
            "uploading",
            "succeeded",
            "failed",
            "cancelled",
        }
        assert {s.value for s in RenderStatus} == expected


# ---------------------------------------------------------------------------
# Render DB model CRUD (async)
# ---------------------------------------------------------------------------


class TestRenderModel:
    def test_render_id_prefix(self) -> None:
        r = Render()
        assert r.id.startswith("render_")

    def test_render_default_status(self) -> None:
        r = Render()
        assert r.status == RenderStatus.QUEUED.value

    def test_render_timestamps_set(self) -> None:
        r = Render()
        assert r.created_at is not None
        assert r.updated_at is not None

    def test_render_unique_ids(self) -> None:
        ids = {Render().id for _ in range(100)}
        assert len(ids) == 100


@pytest.fixture
async def async_session():
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlmodel import SQLModel
    from sqlmodel.ext.asyncio.session import AsyncSession

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        echo=False,
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with AsyncSession(engine) as session:
        yield session
    await engine.dispose()


class TestRenderCRUD:
    @pytest.mark.asyncio
    async def test_create_and_read(self, async_session) -> None:  # type: ignore[no-untyped-def]
        r = Render()
        async_session.add(r)
        await async_session.commit()
        await async_session.refresh(r)

        stmt = select(Render).where(Render.id == r.id)
        result = await async_session.exec(stmt)  # type: ignore[call-overload]
        fetched = result.one()
        assert fetched.id == r.id
        assert fetched.status == "queued"

    @pytest.mark.asyncio
    async def test_update_status(self, async_session) -> None:  # type: ignore[no-untyped-def]
        r = Render()
        async_session.add(r)
        await async_session.commit()
        await async_session.refresh(r)

        r.status = RenderStatus.FETCHING.value
        async_session.add(r)
        await async_session.commit()
        await async_session.refresh(r)

        assert r.status == "fetching"

    @pytest.mark.asyncio
    async def test_error_fields(self, async_session) -> None:  # type: ignore[no-untyped-def]
        r = Render(
            error_code="RENDER_TIMEOUT",
            error_message="Render exceeded 600s timeout",
        )
        async_session.add(r)
        await async_session.commit()
        await async_session.refresh(r)

        assert r.error_code == "RENDER_TIMEOUT"
        assert r.error_message == "Render exceeded 600s timeout"
