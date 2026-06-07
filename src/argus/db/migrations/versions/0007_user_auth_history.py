"""add user auth, job ownership, and saved api keys

Revision ID: 0007_user_auth_history
Revises: 0006_add_audit_depth_fields
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_user_auth_history"
down_revision = "0006_add_audit_depth_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "user_api_keys",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("last4", sa.String(length=8), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_api_keys_user_id", "user_api_keys", ["user_id"])
    op.create_index("ix_user_api_keys_fingerprint", "user_api_keys", ["fingerprint"])

    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(sa.Column("owner_user_id", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("visibility", sa.String(), nullable=False, server_default="private")
        )
        batch_op.add_column(sa.Column("input_text", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column("input_mode", sa.String(), nullable=False, server_default="pdf")
        )
        batch_op.add_column(
            sa.Column("content_domain", sa.String(), nullable=False, server_default="general")
        )
        batch_op.add_column(
            sa.Column("auto_review", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(
            sa.Column("claims_total", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("claims_audited", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.create_foreign_key("fk_jobs_owner_user_id", "users", ["owner_user_id"], ["id"])

    op.create_index("ix_jobs_owner_user_id", "jobs", ["owner_user_id"])


def downgrade() -> None:
    op.drop_index("ix_jobs_owner_user_id", table_name="jobs")
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_constraint("fk_jobs_owner_user_id", type_="foreignkey")
        batch_op.drop_column("claims_audited")
        batch_op.drop_column("claims_total")
        batch_op.drop_column("auto_review")
        batch_op.drop_column("content_domain")
        batch_op.drop_column("input_mode")
        batch_op.drop_column("input_text")
        batch_op.drop_column("visibility")
        batch_op.drop_column("owner_user_id")

    op.drop_index("ix_user_api_keys_fingerprint", table_name="user_api_keys")
    op.drop_index("ix_user_api_keys_user_id", table_name="user_api_keys")
    op.drop_table("user_api_keys")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
