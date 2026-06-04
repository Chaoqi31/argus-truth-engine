"""add stages JSON column to jobs

Revision ID: 0005_add_jobs_stages
Revises: 0004_add_finding_confidence_breakdown
Create Date: 2026-06-04
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_add_jobs_stages"
down_revision = "0004_add_finding_confidence_breakdown"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("stages", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    # SQLite cannot DROP COLUMN without table rebuild — use batch mode so the
    # downgrade works on both SQLite and Postgres.
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_column("stages")
