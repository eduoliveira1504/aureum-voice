"""voice moderation

Revision ID: c2d7e5f0a913
Revises: b83f4d1a6c20
Create Date: 2026-10-18 13:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c2d7e5f0a913'
down_revision: str | None = 'b83f4d1a6c20'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('server_members', sa.Column('voice_muted', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('server_members', sa.Column('voice_deafened', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('server_members', 'voice_deafened')
    op.drop_column('server_members', 'voice_muted')
