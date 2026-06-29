"""Integration tests for template CRUD endpoints and edge cases."""

from __future__ import annotations

import pytest

SAMPLE_COMPOSITION = {
    "timeline": {
        "background": "#000000",
        "tracks": [
            {
                "clips": [
                    {
                        "asset": {
                            "type": "image",
                            "src": "https://example.com/img.jpg",
                        },
                        "start": 0.0,
                        "length": 3.0,
                    }
                ]
            }
        ],
    },
    "output": {"format": "mp4", "width": 1920, "height": 1080},
}


def _create_payload(
    name: str = "Test Template",
    description: str | None = "A test",
    composition: dict | None = None,
) -> dict:
    return {
        "name": name,
        "description": description,
        "composition": composition or SAMPLE_COMPOSITION,
    }


# ---------------------------------------------------------------------------
# POST /v1/templates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_template_success(client):
    resp = await client.post("/v1/templates", json=_create_payload())
    assert resp.status_code == 201

    data = resp.json()
    assert data["id"].startswith("tmpl_")
    assert data["name"] == "Test Template"
    assert data["description"] == "A test"
    assert data["active_version"]["version_number"] == 1
    assert data["active_version"]["id"].startswith("tver_")
    stored_comp = data["active_version"]["composition"]
    assert stored_comp["timeline"]["background"] == "#000000"
    assert stored_comp["output"]["format"] == "mp4"
    assert stored_comp["output"]["width"] == 1920
    assert stored_comp["output"]["height"] == 1080


@pytest.mark.asyncio
async def test_create_template_minimal_fields(client):
    resp = await client.post(
        "/v1/templates",
        json={"name": "Minimal", "composition": SAMPLE_COMPOSITION},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Minimal"
    assert data["description"] is None


@pytest.mark.asyncio
async def test_create_template_invalid_composition(client):
    resp = await client.post(
        "/v1/templates",
        json={"name": "Bad", "composition": {"invalid": True}},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_template_empty_name(client):
    resp = await client.post(
        "/v1/templates",
        json={"name": "", "composition": SAMPLE_COMPOSITION},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /v1/templates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_templates_empty(client):
    resp = await client.get("/v1/templates")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_list_templates_with_items(client):
    for i in range(3):
        await client.post("/v1/templates", json=_create_payload(name=f"T{i}"))

    resp = await client.get("/v1/templates")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert len(data["items"]) == 3


@pytest.mark.asyncio
async def test_list_templates_pagination(client):
    for i in range(5):
        await client.post("/v1/templates", json=_create_payload(name=f"T{i}"))

    resp = await client.get("/v1/templates?offset=0&limit=2")
    data = resp.json()
    assert data["total"] == 5
    assert len(data["items"]) == 2
    assert data["offset"] == 0
    assert data["limit"] == 2

    resp2 = await client.get("/v1/templates?offset=2&limit=2")
    data2 = resp2.json()
    assert len(data2["items"]) == 2
    assert data2["items"][0]["id"] != data["items"][0]["id"]


@pytest.mark.asyncio
async def test_list_templates_limit_clamped(client):
    resp = await client.get("/v1/templates?limit=0")
    data = resp.json()
    assert data["limit"] == 1

    resp2 = await client.get("/v1/templates?limit=200")
    data2 = resp2.json()
    assert data2["limit"] == 100


@pytest.mark.asyncio
async def test_list_templates_negative_offset(client):
    resp = await client.get("/v1/templates?offset=-5")
    data = resp.json()
    assert data["offset"] == 0


# ---------------------------------------------------------------------------
# GET /v1/templates/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_template_success(client):
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    resp = await client.get(f"/v1/templates/{template_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == template_id
    assert data["name"] == "Test Template"
    assert data["active_version"]["version_number"] == 1
    assert data["is_deleted"] is False


@pytest.mark.asyncio
async def test_get_template_not_found(client):
    resp = await client.get("/v1/templates/tmpl_nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_soft_deleted_template_by_id(client):
    """Soft-deleted templates should still be retrievable by direct ID."""
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    await client.delete(f"/v1/templates/{template_id}")

    resp = await client.get(f"/v1/templates/{template_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_deleted"] is True


# ---------------------------------------------------------------------------
# PUT /v1/templates/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_template_name_only(client):
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    resp = await client.put(
        f"/v1/templates/{template_id}",
        json={"name": "Renamed"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Renamed"
    assert data["active_version"]["version_number"] == 1


@pytest.mark.asyncio
async def test_update_template_with_new_composition(client):
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    new_comp = {
        "timeline": {
            "background": "#ffffff",
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {
                                "type": "image",
                                "src": "https://example.com/new.jpg",
                            },
                            "start": 0.0,
                            "length": 5.0,
                        }
                    ]
                }
            ],
        },
        "output": {"format": "mp4", "width": 1280, "height": 720},
    }

    resp = await client.put(
        f"/v1/templates/{template_id}",
        json={"composition": new_comp},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["active_version"]["version_number"] == 2
    stored_comp = data["active_version"]["composition"]
    assert stored_comp["timeline"]["background"] == "#ffffff"
    assert stored_comp["output"]["width"] == 1280
    assert stored_comp["output"]["height"] == 720


@pytest.mark.asyncio
async def test_update_template_not_found(client):
    resp = await client.put(
        "/v1/templates/tmpl_nonexistent",
        json={"name": "Ghost"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_deleted_template_returns_409(client):
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    await client.delete(f"/v1/templates/{template_id}")

    resp = await client.put(
        f"/v1/templates/{template_id}",
        json={"name": "Zombie"},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_update_template_empty_body_422(client):
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    resp = await client.put(f"/v1/templates/{template_id}", json={})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# DELETE /v1/templates/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_template_success(client):
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    resp = await client.delete(f"/v1/templates/{template_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "deleted"

    list_resp = await client.get("/v1/templates")
    assert list_resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_delete_template_not_found(client):
    resp = await client.delete("/v1/templates/tmpl_nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_already_deleted_returns_409(client):
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    await client.delete(f"/v1/templates/{template_id}")

    resp = await client.delete(f"/v1/templates/{template_id}")
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Edge cases (T019)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_version_increment_on_multiple_updates(client):
    """Updating composition multiple times should increment version numbers."""
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    for i in range(2, 5):
        resp = await client.put(
            f"/v1/templates/{template_id}",
            json={"composition": SAMPLE_COMPOSITION},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["active_version"]["version_number"] == i


@pytest.mark.asyncio
async def test_soft_deleted_excluded_from_list_but_retrievable(client):
    """Soft-deleted templates are excluded from list but retrievable by ID."""
    create_resp = await client.post(
        "/v1/templates", json=_create_payload(name="Deletable")
    )
    template_id = create_resp.json()["id"]

    await client.delete(f"/v1/templates/{template_id}")

    list_resp = await client.get("/v1/templates")
    ids = [item["id"] for item in list_resp.json()["items"]]
    assert template_id not in ids

    get_resp = await client.get(f"/v1/templates/{template_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["is_deleted"] is True


@pytest.mark.asyncio
async def test_pagination_beyond_total(client):
    """Offset beyond total returns empty items with correct total."""
    await client.post("/v1/templates", json=_create_payload(name="Only One"))

    resp = await client.get("/v1/templates?offset=100&limit=20")
    data = resp.json()
    assert data["total"] == 1
    assert len(data["items"]) == 0


@pytest.mark.asyncio
async def test_create_templates_with_same_name(client):
    """Duplicate names are allowed (no unique constraint on name)."""
    resp1 = await client.post("/v1/templates", json=_create_payload(name="Duplicate"))
    resp2 = await client.post("/v1/templates", json=_create_payload(name="Duplicate"))
    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] != resp2.json()["id"]


@pytest.mark.asyncio
async def test_large_composition(client):
    """A composition with many tracks should be accepted."""
    large_comp = {
        "timeline": {
            "background": "#000000",
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {
                                "type": "text",
                                "text": f"Slide {i}",
                            },
                            "start": float(i),
                            "length": 1.0,
                        }
                    ]
                }
                for i in range(20)
            ],
        },
        "output": {"format": "mp4", "width": 1920, "height": 1080},
    }

    resp = await client.post(
        "/v1/templates",
        json=_create_payload(name="Large", composition=large_comp),
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_update_description_only(client):
    """Updating only description should not create a new version."""
    create_resp = await client.post("/v1/templates", json=_create_payload())
    template_id = create_resp.json()["id"]

    resp = await client.put(
        f"/v1/templates/{template_id}",
        json={"description": "Updated description"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["description"] == "Updated description"
    assert data["active_version"]["version_number"] == 1
