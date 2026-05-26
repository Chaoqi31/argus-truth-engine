"""arch improvements: interrupted status, finding cache, from_cache column

Revision ID: 0003_arch_improvements
Revises: 0002_add_finding_unified_verifier_fields
Create Date: 2026-05-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_arch_improvements"
down_revision = "0002_add_finding_unified_verifier_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. finding_cache table — works in both Postgres and SQLite
    op.create_table(
        "finding_cache",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("verifier_version", sa.String(16), nullable=False, index=True),
        sa.Column("content_domain", sa.String(32), nullable=False, index=True),
        sa.Column("hit_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime, nullable=False, index=True),
    )

    # 2. findings.from_cache column
    op.add_column(
        "findings",
        sa.Column("from_cache", sa.Boolean, nullable=False, server_default=sa.false()),
    )

    # 3. Extend jobs.status check constraint — Postgres only. SQLite uses
    # plain TEXT and validates at the app layer (no migration needed).
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check")
        op.execute(
            "ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK ("
            "status IN ('queued','parsing','planning','atomizing','filtering',"
            "'reviewing','verifying','reporting','done','failed','interrupted'))"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check")
        op.execute(
            "ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK ("
            "status IN ('queued','parsing','planning','atomizing','filtering',"
            "'reviewing','verifying','reporting','done','failed'))"
        )
    op.drop_column("findings", "from_cache")
    op.drop_table("finding_cache")
