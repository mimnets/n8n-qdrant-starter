"""Tests for DELETE /v1/renders/{id} cancellation endpoint."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.db import render_crud
from app.models.render import RenderStatus


@pytest.mark.asyncio
class TestCancelRenderEndpoint:
    """Tests for DELETE /v1/renders/{id}."""

    async def test_cancel_queued_render(self, client: AsyncClient, db_session):
        """Queued render transitions immediately to CANCELLED."""
        render = await render_crud.create_render(db_session)

        resp = await client.delete(f"/v1/renders/{render.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "cancelled"

        check = await client.get(f"/v1/renders/{render.id}")
        assert check.json()["status"] == "cancelled"

    async def test_cancel_running_render(self, client: AsyncClient, db_session):
        """Running render gets cancel flag set (best-effort)."""
        render = await render_crud.create_render(db_session)
        render_id = render.id
        await render_crud.update_render_status(
            db_session, render_id, RenderStatus.FETCHING
        )
        await render_crud.update_render_status(
            db_session, render_id, RenderStatus.COMPILING
        )
        await render_crud.update_render_status(
            db_session, render_id, RenderStatus.RENDERING
        )

        resp = await client.delete(f"/v1/renders/{render_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "rendering"
        assert "cancel requested" in data["detail"].lower()

        db_session.expire_all()
        updated = await render_crud.get_render_by_id(db_session, render_id)
        assert updated is not None
        assert updated.cancel_requested_at is not None

    async def test_cancel_not_found(self, client: AsyncClient):
        """Non-existent render returns 404."""
        resp = await client.delete("/v1/renders/nonexistent_id")
        assert resp.status_code == 404

    async def test_cancel_already_terminal_succeeded(
        self, client: AsyncClient, db_session
    ):
        """Cannot cancel a succeeded render (409)."""
        render = await render_crud.create_render(db_session)
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.FETCHING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.COMPILING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.RENDERING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.UPLOADING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.SUCCEEDED
        )

        resp = await client.delete(f"/v1/renders/{render.id}")
        assert resp.status_code == 409

    async def test_cancel_already_terminal_failed(
        self, client: AsyncClient, db_session
    ):
        """Cannot cancel a failed render (409)."""
        render = await render_crud.create_render(db_session)
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.FETCHING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.FAILED, error_code="TEST"
        )

        resp = await client.delete(f"/v1/renders/{render.id}")
        assert resp.status_code == 409

    async def test_idempotent_re_cancel(self, client: AsyncClient, db_session):
        """Cancelling an already-cancelled render returns 200 (idempotent)."""
        render = await render_crud.create_render(db_session)

        resp1 = await client.delete(f"/v1/renders/{render.id}")
        assert resp1.status_code == 200

        resp2 = await client.delete(f"/v1/renders/{render.id}")
        assert resp2.status_code == 200
        data = resp2.json()
        assert data["status"] == "cancelled"
        assert "already" in data["detail"].lower()

    async def test_cancel_fetching_render(self, client: AsyncClient, db_session):
        """Fetching render gets cancel flag set."""
        render = await render_crud.create_render(db_session)
        render_id = render.id
        await render_crud.update_render_status(
            db_session, render_id, RenderStatus.FETCHING
        )

        resp = await client.delete(f"/v1/renders/{render_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "fetching"

        db_session.expire_all()
        updated = await render_crud.get_render_by_id(db_session, render_id)
        assert updated is not None
        assert updated.cancel_requested_at is not None

    async def test_cancel_compiling_render(self, client: AsyncClient, db_session):
        """Compiling render gets cancel flag set."""
        render = await render_crud.create_render(db_session)
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.FETCHING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.COMPILING
        )

        resp = await client.delete(f"/v1/renders/{render.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "compiling"

    async def test_cancel_uploading_render(self, client: AsyncClient, db_session):
        """Uploading render gets cancel flag set."""
        render = await render_crud.create_render(db_session)
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.FETCHING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.COMPILING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.RENDERING
        )
        await render_crud.update_render_status(
            db_session, render.id, RenderStatus.UPLOADING
        )

        resp = await client.delete(f"/v1/renders/{render.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "uploading"
