"""attachment encryption metadata, thumbnails, office preview

Revision ID: 0007_attachment_media
Revises: 0006_device_sessions
Create Date: 2026-08-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_attachment_media"
down_revision = "0006_device_sessions"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("attachments", sa.Column("encrypted_meta", sa.Text(), nullable=True))
    op.add_column("attachments", sa.Column("meta_nonce", sa.String(length=64), nullable=True))
    op.add_column("attachments", sa.Column("thumbnail_key", sa.String(length=64), nullable=True))
    op.add_column("attachments", sa.Column("preview_key", sa.String(length=64), nullable=True))
    op.alter_column("attachments", "filename", existing_type=sa.String(length=255), nullable=True)


def downgrade():
    op.alter_column("attachments", "filename", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("attachments", "preview_key")
    op.drop_column("attachments", "thumbnail_key")
    op.drop_column("attachments", "meta_nonce")
    op.drop_column("attachments", "encrypted_meta")
