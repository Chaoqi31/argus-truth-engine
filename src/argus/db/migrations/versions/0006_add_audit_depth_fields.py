"""add audit depth JSON fields to findings

Revision ID: 0006_add_audit_depth_fields
Revises: 0005_add_jobs_stages
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_add_audit_depth_fields"
down_revision = "0005_add_jobs_stages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("findings") as batch_op:
        batch_op.add_column(sa.Column("evidence_quality", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("coverage", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("skeptic_review", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("computation_check", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("findings") as batch_op:
        batch_op.drop_column("computation_check")
        batch_op.drop_column("skeptic_review")
        batch_op.drop_column("coverage")
        batch_op.drop_column("evidence_quality")
