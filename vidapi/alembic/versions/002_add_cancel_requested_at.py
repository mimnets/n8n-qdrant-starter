"""Add cancel_requested_at column to renders

Revision ID: 002
Revises: 001
Create Date: 2026-05-05

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "002"
down_revision: str | None = "001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "renders",
        sa.Column("cancel_requested_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("renders", "cancel_requested_at")
