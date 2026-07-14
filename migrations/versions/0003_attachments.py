"""attachments

Revision ID: 0003_attachments
Revises: 0002_biography_records
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_attachments"
down_revision = "0002_biography_records"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("caption", sa.String(length=500), nullable=True),
        sa.Column("uploaded_by", sa.String(length=150), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["biography_records.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_attachments_record_id", "attachments", ["record_id"])


def downgrade():
    op.drop_index("ix_attachments_record_id", table_name="attachments")
    op.drop_table("attachments")
