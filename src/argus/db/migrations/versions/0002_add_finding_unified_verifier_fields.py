"""add why_wrong and correct_info columns to findings

Revision ID: 0002_add_finding_unified_verifier_fields
Revises: 0001_initial
Create Date: 2026-05-26 00:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_add_finding_unified_verifier_fields"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("findings", sa.Column("why_wrong", sa.String(), nullable=True))
    op.add_column("findings", sa.Column("correct_info_value", sa.String(), nullable=True))
    op.add_column("findings", sa.Column("correct_info_source", sa.String(), nullable=True))
    op.add_column("findings", sa.Column("correct_info_url", sa.String(), nullable=True))
    op.add_column("findings", sa.Column("correct_info_retrieved_date", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("findings", "correct_info_retrieved_date")
    op.drop_column("findings", "correct_info_url")
    op.drop_column("findings", "correct_info_source")
    op.drop_column("findings", "correct_info_value")
    op.drop_column("findings", "why_wrong")
