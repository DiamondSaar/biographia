"""biography records

Revision ID: 0002_biography_records
Revises: 0001_sso_ticket_use
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_biography_records"
down_revision = "0001_sso_ticket_use"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "biography_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("entity_kind", sa.String(length=20), nullable=True),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("zone", sa.String(length=20), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=True),
        sa.Column("access_level", sa.String(length=1), nullable=True),
        sa.Column("record_type", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("author_username", sa.String(length=150), nullable=False),
        sa.Column("author_display_name", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_biography_records_entity_id", "biography_records", ["entity_id"])
    op.create_index("ix_biography_records_org_id", "biography_records", ["org_id"])

    op.create_table(
        "biography_record_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("record_type", sa.String(length=30), nullable=False),
        sa.Column("author_username", sa.String(length=150), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["biography_records.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("record_id", "version_number", name="uq_record_version"),
    )
    op.create_index("ix_biography_record_versions_record_id", "biography_record_versions", ["record_id"])


def downgrade():
    op.drop_index("ix_biography_record_versions_record_id", table_name="biography_record_versions")
    op.drop_table("biography_record_versions")
    op.drop_index("ix_biography_records_org_id", table_name="biography_records")
    op.drop_index("ix_biography_records_entity_id", table_name="biography_records")
    op.drop_table("biography_records")
