"""group icons

Revision ID: b4e8f1a2c693
Revises: a7d2c4e9f318
Create Date: 2026-10-19 12:00:00.000000

Group DMs get a picture (channels.icon_url, groups only).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'b4e8f1a2c693'
down_revision: str | None = 'a7d2c4e9f318'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('channels', sa.Column('icon_url', sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column('channels', 'icon_url')
