"""Tests for GET /v1/renders list endpoint."""

from __future__ import annotations

import asyncio

import pytest
from httpx import AsyncClient

from app.db import render_crud
from app.models.render import RenderStatus


@pytest.mark.asyncio
class TestListRendersEndpoint:
    """Tests for GET /v1/renders."""

    async def test_empty_list(self, client: AsyncClient):
        """Empty database returns empty list."""
        resp = await client.get("/v1/renders")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["offset"] == 0
        assert data["limit"] == 20

    async def test_multiple_renders(self, client: AsyncClient, db_session):
        """Multiple renders returned in created_at DESC order."""
        for _ in range(3):
            await render_crud.create_render(db_session)
            await asyncio.sleep(0.01)

        resp = await client.get("/v1/renders")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert len(data["items"]) == 3

        dates = [item["created_at"] for item in data["items"]]
        assert dates == sorted(dates, reverse=True)

    async def test_pagination_offset(self, client: AsyncClient, db_session):
        """Offset skips the first N results."""
        for _ in range(5):
            await render_crud.create_render(db_session)
            await asyncio.sleep(0.01)

        resp = await client.get("/v1/renders?offset=2&limit=2")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        assert len(data["items"]) == 2
        assert data["offset"] == 2
        assert data["limit"] == 2

    async def test_pagination_limit(self, client: AsyncClient, db_session):
        """Limit caps the number of results."""
        for _ in range(5):
            await render_crud.create_render(db_session)

        resp = await client.get("/v1/renders?limit=3")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        assert len(data["items"]) == 3

    async def test_status_filter(self, client: AsyncClient, db_session):
        """Status filter returns only matching renders."""
        r1 = await render_crud.create_render(db_session)
        r1_id = r1.id
        r2 = await render_crud.create_render(db_session)
        r2_id = r2.id

        await render_crud.update_render_status(db_session, r1_id, RenderStatus.FETCHING)
        await render_crud.update_render_status(
            db_session, r1_id, RenderStatus.FAILED, error_code="TEST"
        )

        resp = await client.get("/v1/renders?status_filter=queued")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == r2_id

        resp = await client.get("/v1/renders?status_filter=failed")
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == r1_id

    async def test_invalid_status_filter(self, client: AsyncClient):
        """Invalid status filter returns 422."""
        resp = await client.get("/v1/renders?status_filter=bogus")
        assert resp.status_code == 422

    async def test_offset_beyond_total(self, client: AsyncClient, db_session):
        """Offset beyond total returns empty list."""
        await render_crud.create_render(db_session)

        resp = await client.get("/v1/renders?offset=100")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["items"]) == 0

    async def test_limit_clamped_to_max(self, client: AsyncClient, db_session):
        """Limit above 100 is clamped to 100."""
        await render_crud.create_render(db_session)

        resp = await client.get("/v1/renders?limit=500")
        assert resp.status_code == 200
        data = resp.json()
        assert data["limit"] == 100

    async def test_negative_offset_clamped(self, client: AsyncClient, db_session):
        """Negative offset treated as 0."""
        await render_crud.create_render(db_session)

        resp = await client.get("/v1/renders?offset=-5")
        assert resp.status_code == 200
        data = resp.json()
        assert data["offset"] == 0

    async def test_list_item_fields(self, client: AsyncClient, db_session):
        """List items contain expected fields."""
        await render_crud.create_render(db_session)

        resp = await client.get("/v1/renders")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert "id" in item
        assert "status" in item
        assert "progress" in item
        assert "created_at" in item
        assert item["status"] == "queued"
        assert item["progress"] == 0
