"""add confidence_breakdown JSON column to findings

Revision ID: 0004_add_finding_confidence_breakdown
Revises: 0003_arch_improvements
Create Date: 2026-05-28
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_add_finding_confidence_breakdown"
down_revision = "0003_arch_improvements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "findings",
        sa.Column("confidence_breakdown", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    # SQLite cannot DROP COLUMN without table rebuild — use batch mode so the
    # downgrade works on both SQLite and Postgres.
    with op.batch_alter_table("findings") as batch_op:
        batch_op.drop_column("confidence_breakdown")
