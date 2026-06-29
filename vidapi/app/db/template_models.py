from __future__ import annotations

import os
import time
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.db.time import utcnow_naive


def _base36(n: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    result: list[str] = []
    while n:
        n, rem = divmod(n, 36)
        result.append(chars[rem])
    return "".join(reversed(result))


def _generate_template_id() -> str:
    """Generate a sortable template ID with ``tmpl_`` prefix."""
    ts = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(5))
    encoded = _base36(ts) + _base36(rand).zfill(8)
    return f"tmpl_{encoded}"


def _generate_version_id() -> str:
    """Generate a sortable template version ID with ``tver_`` prefix."""
    ts = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(5))
    encoded = _base36(ts) + _base36(rand).zfill(8)
    return f"tver_{encoded}"


class Template(SQLModel, table=True):
    __tablename__ = "templates"

    id: str = Field(default_factory=_generate_template_id, primary_key=True)
    name: str = Field(index=True)
    description: str | None = Field(default=None)
    active_version_id: str | None = Field(default=None)
    variable_schema: str | None = Field(default=None)
    is_deleted: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=utcnow_naive)
    updated_at: datetime = Field(default_factory=utcnow_naive)


class TemplateVersion(SQLModel, table=True):
    __tablename__ = "template_versions"

    id: str = Field(default_factory=_generate_version_id, primary_key=True)
    template_id: str = Field(foreign_key="templates.id", index=True)
    version_number: int = Field(ge=1)
    composition: str
    variable_schema: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow_naive)
