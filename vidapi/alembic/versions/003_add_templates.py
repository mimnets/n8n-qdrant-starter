"""Add templates and template_versions tables

Revision ID: 003
Revises: 002
Create Date: 2026-05-05

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "003"
down_revision: str | None = "002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "templates",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("active_version_id", sa.String(), nullable=True),
        sa.Column("variable_schema", sa.String(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_templates_name", "templates", ["name"])
    op.create_index("ix_templates_is_deleted", "templates", ["is_deleted"])

    op.create_table(
        "template_versions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("template_id", sa.String(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("composition", sa.String(), nullable=False),
        sa.Column("variable_schema", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["template_id"], ["templates.id"]),
    )
    op.create_index(
        "ix_template_versions_template_id",
        "template_versions",
        ["template_id"],
    )
    op.create_index(
        "ix_template_versions_unique_version",
        "template_versions",
        ["template_id", "version_number"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_template_versions_unique_version", table_name="template_versions")
    op.drop_index("ix_template_versions_template_id", table_name="template_versions")
    op.drop_table("template_versions")
    op.drop_index("ix_templates_is_deleted", table_name="templates")
    op.drop_index("ix_templates_name", table_name="templates")
    op.drop_table("templates")
