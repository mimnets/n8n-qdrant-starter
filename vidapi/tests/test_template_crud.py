"""Unit tests for template CRUD functions."""

from __future__ import annotations

import json

import pytest

from app.db import template_crud

SAMPLE_COMPOSITION = json.dumps(
    {
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
)


@pytest.mark.asyncio
async def test_create_template(db_session):
    template, version = await template_crud.create_template(
        db_session,
        name="Test Template",
        composition_json=SAMPLE_COMPOSITION,
        description="A test template",
    )

    assert template.id.startswith("tmpl_")
    assert template.name == "Test Template"
    assert template.description == "A test template"
    assert template.is_deleted is False
    assert template.active_version_id == version.id

    assert version.id.startswith("tver_")
    assert version.version_number == 1
    assert version.template_id == template.id
    assert version.composition == SAMPLE_COMPOSITION


@pytest.mark.asyncio
async def test_create_template_minimal(db_session):
    template, version = await template_crud.create_template(
        db_session,
        name="Minimal",
        composition_json=SAMPLE_COMPOSITION,
    )
    assert template.description is None
    assert template.variable_schema is None
    assert version.variable_schema is None


@pytest.mark.asyncio
async def test_create_template_with_variable_schema(db_session):
    schema = json.dumps({"headline": {"type": "string"}})
    template, version = await template_crud.create_template(
        db_session,
        name="With Schema",
        composition_json=SAMPLE_COMPOSITION,
        variable_schema_json=schema,
    )
    assert template.variable_schema == schema
    assert version.variable_schema == schema


@pytest.mark.asyncio
async def test_get_template_by_id(db_session):
    template, _ = await template_crud.create_template(
        db_session,
        name="Findable",
        composition_json=SAMPLE_COMPOSITION,
    )

    found = await template_crud.get_template_by_id(db_session, template.id)
    assert found is not None
    assert found.id == template.id
    assert found.name == "Findable"


@pytest.mark.asyncio
async def test_get_template_by_id_not_found(db_session):
    found = await template_crud.get_template_by_id(db_session, "tmpl_nonexistent")
    assert found is None


@pytest.mark.asyncio
async def test_get_active_version(db_session):
    template, version = await template_crud.create_template(
        db_session,
        name="Versioned",
        composition_json=SAMPLE_COMPOSITION,
    )

    active = await template_crud.get_active_version(db_session, template)
    assert active is not None
    assert active.id == version.id


@pytest.mark.asyncio
async def test_list_templates_basic(db_session):
    for i in range(3):
        await template_crud.create_template(
            db_session,
            name=f"Template {i}",
            composition_json=SAMPLE_COMPOSITION,
        )

    items, total = await template_crud.list_templates(db_session)
    assert total == 3
    assert len(items) == 3
    assert items[0].created_at >= items[1].created_at


@pytest.mark.asyncio
async def test_list_templates_excludes_deleted(db_session):
    t1, _ = await template_crud.create_template(
        db_session, name="Active", composition_json=SAMPLE_COMPOSITION
    )
    t2, _ = await template_crud.create_template(
        db_session, name="Deleted", composition_json=SAMPLE_COMPOSITION
    )
    await template_crud.soft_delete_template(db_session, t2.id)

    items, total = await template_crud.list_templates(db_session)
    assert total == 1
    assert items[0].id == t1.id


@pytest.mark.asyncio
async def test_list_templates_pagination(db_session):
    for i in range(5):
        await template_crud.create_template(
            db_session,
            name=f"Template {i}",
            composition_json=SAMPLE_COMPOSITION,
        )

    items, total = await template_crud.list_templates(db_session, offset=0, limit=2)
    assert total == 5
    assert len(items) == 2

    items2, total2 = await template_crud.list_templates(db_session, offset=2, limit=2)
    assert total2 == 5
    assert len(items2) == 2
    assert items2[0].id != items[0].id


@pytest.mark.asyncio
async def test_update_template_name_only(db_session):
    template, v1 = await template_crud.create_template(
        db_session, name="Original", composition_json=SAMPLE_COMPOSITION
    )
    v1_id = v1.id

    updated, new_version = await template_crud.update_template(
        db_session, template.id, name="Renamed"
    )

    assert updated.name == "Renamed"
    assert new_version is None
    assert updated.active_version_id == v1_id


@pytest.mark.asyncio
async def test_update_template_with_new_composition(db_session):
    template, _v1 = await template_crud.create_template(
        db_session, name="To Update", composition_json=SAMPLE_COMPOSITION
    )

    new_comp = json.dumps(
        {
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
                                "start": 0,
                                "length": 5,
                            }
                        ],
                    }
                ],
            },
            "output": {"format": "mp4", "width": 1280, "height": 720},
        }
    )

    updated, new_version = await template_crud.update_template(
        db_session, template.id, composition_json=new_comp
    )

    assert new_version is not None
    assert new_version.version_number == 2
    assert new_version.composition == new_comp
    assert updated.active_version_id == new_version.id


@pytest.mark.asyncio
async def test_soft_delete_template(db_session):
    template, _ = await template_crud.create_template(
        db_session, name="To Delete", composition_json=SAMPLE_COMPOSITION
    )

    deleted = await template_crud.soft_delete_template(db_session, template.id)
    assert deleted.is_deleted is True


@pytest.mark.asyncio
async def test_soft_delete_already_deleted_raises(db_session):
    template, _ = await template_crud.create_template(
        db_session, name="Double Delete", composition_json=SAMPLE_COMPOSITION
    )
    await template_crud.soft_delete_template(db_session, template.id)

    with pytest.raises(ValueError, match="already deleted"):
        await template_crud.soft_delete_template(db_session, template.id)


@pytest.mark.asyncio
async def test_get_version_count(db_session):
    template, _ = await template_crud.create_template(
        db_session, name="Multi Version", composition_json=SAMPLE_COMPOSITION
    )
    count = await template_crud.get_version_count(db_session, template.id)
    assert count == 1

    await template_crud.update_template(
        db_session, template.id, composition_json=SAMPLE_COMPOSITION
    )
    count = await template_crud.get_version_count(db_session, template.id)
    assert count == 2
