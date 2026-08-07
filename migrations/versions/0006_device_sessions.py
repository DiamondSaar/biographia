"""device sessions (mobile app token login)

Revision ID: 0006_device_sessions
Revises: 0005_record_ownership
Create Date: 2026-08-08
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_device_sessions"
down_revision = "0005_record_ownership"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "device_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("username", sa.String(length=150), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("access_class", sa.String(length=1), nullable=True),
        sa.Column("organization", sa.JSON(), nullable=True),
        sa.Column("role", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_device_sessions_token_hash", "device_sessions", ["token_hash"])
    op.create_index("ix_device_sessions_username", "device_sessions", ["username"])


def downgrade():
    op.drop_index("ix_device_sessions_username", table_name="device_sessions")
    op.drop_index("ix_device_sessions_token_hash", table_name="device_sessions")
    op.drop_table("device_sessions")
