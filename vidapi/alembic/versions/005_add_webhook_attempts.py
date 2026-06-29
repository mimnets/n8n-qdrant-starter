"""Add webhook_attempts table and renders.callback_url column

Revision ID: 005
Revises: 004
Create Date: 2026-05-05

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "webhook_attempts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("render_id", sa.String(), nullable=False, index=True),
        sa.Column("event", sa.String(), nullable=False, index=True),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("response_body_excerpt", sa.String(), nullable=True),
        sa.Column("attempt_number", sa.Integer(), nullable=False, default=1),
        sa.Column("scheduled_at", sa.DateTime(), nullable=False),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.add_column(
        "renders",
        sa.Column("callback_url", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("renders", "callback_url")
    op.drop_table("webhook_attempts")
