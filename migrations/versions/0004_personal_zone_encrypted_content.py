"""personal zone encrypted content

Revision ID: 0004_personal_zone_crypto
Revises: 0003_attachments
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_personal_zone_crypto"
down_revision = "0003_attachments"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("biography_records", sa.Column("encrypted_content", sa.Text(), nullable=True))
    op.add_column("biography_records", sa.Column("nonce", sa.String(length=64), nullable=True))
    op.add_column("biography_record_versions", sa.Column("encrypted_content", sa.Text(), nullable=True))
    op.add_column("biography_record_versions", sa.Column("nonce", sa.String(length=64), nullable=True))


def downgrade():
    op.drop_column("biography_record_versions", "nonce")
    op.drop_column("biography_record_versions", "encrypted_content")
    op.drop_column("biography_records", "nonce")
    op.drop_column("biography_records", "encrypted_content")
