"""sso ticket use

Revision ID: 0001_sso_ticket_use
Revises:
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0001_sso_ticket_use"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sso_ticket_uses",
        sa.Column("jti", sa.String(length=36), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("jti"),
    )


def downgrade():
    op.drop_table("sso_ticket_uses")
