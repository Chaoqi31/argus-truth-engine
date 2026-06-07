"""account product hardening

Revision ID: 0008_account_product_hardening
Revises: 0007_user_auth_history
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_account_product_hardening"
down_revision = "0007_user_auth_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_share_links",
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("owner_user_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("last_accessed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"]),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("token"),
    )
    op.create_index("ix_audit_share_links_job_id", "audit_share_links", ["job_id"])
    op.create_index("ix_audit_share_links_owner_user_id", "audit_share_links", ["owner_user_id"])

    op.create_table(
        "audit_access_logs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("actor_type", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("access_metadata", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_access_logs_job_id", "audit_access_logs", ["job_id"])

    op.create_table(
        "analytics_events",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("event_name", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=True),
        sa.Column("properties", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_analytics_events_event_name", "analytics_events", ["event_name"])


def downgrade() -> None:
    op.drop_index("ix_analytics_events_event_name", table_name="analytics_events")
    op.drop_table("analytics_events")
    op.drop_index("ix_audit_access_logs_job_id", table_name="audit_access_logs")
    op.drop_table("audit_access_logs")
    op.drop_index("ix_audit_share_links_owner_user_id", table_name="audit_share_links")
    op.drop_index("ix_audit_share_links_job_id", table_name="audit_share_links")
    op.drop_table("audit_share_links")
