"""record ownership (Владелец/Ответственный) + proposal status + ownership log

Revision ID: 0005_record_ownership
Revises: 0004_personal_zone_crypto
Create Date: 2026-07-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_record_ownership"
down_revision = "0004_personal_zone_crypto"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("biography_records", sa.Column("owner_username", sa.String(length=150), nullable=True))
    op.add_column("biography_records", sa.Column("owner_display_name", sa.String(length=255), nullable=True))
    # Backfill: creator is the initial owner for every row that predates
    # this column - matches the rule for all new rows going forward too.
    op.execute(
        "UPDATE biography_records SET owner_username = author_username, "
        "owner_display_name = author_display_name WHERE owner_username IS NULL"
    )
    with op.batch_alter_table("biography_records") as batch_op:
        batch_op.alter_column("owner_username", existing_type=sa.String(length=150), nullable=False)

    op.add_column(
        "biography_record_versions",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="applied"),
    )
    with op.batch_alter_table("biography_record_versions") as batch_op:
        batch_op.alter_column("status", server_default=None)

    op.create_table(
        "biography_record_ownership_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("from_username", sa.String(length=150), nullable=True),
        sa.Column("to_username", sa.String(length=150), nullable=False),
        sa.Column("changed_by_username", sa.String(length=150), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["biography_records.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_biography_record_ownership_log_record_id"),
        "biography_record_ownership_log",
        ["record_id"],
    )


def downgrade():
    op.drop_index(
        op.f("ix_biography_record_ownership_log_record_id"),
        table_name="biography_record_ownership_log",
    )
    op.drop_table("biography_record_ownership_log")
    op.drop_column("biography_record_versions", "status")
    op.drop_column("biography_records", "owner_display_name")
    op.drop_column("biography_records", "owner_username")
