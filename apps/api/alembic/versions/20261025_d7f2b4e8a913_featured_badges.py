"""user_badges: featured_position; badges: how_to_get

Revision ID: d7f2b4e8a913
Revises: c6e1a9d4f357
Create Date: 2026-10-25 21:00:00.000000

Block 3.10: the holder picks up to 3 badges to show next to their name, in order (NULL: not
featured; none featured keeps the automatic pick). The catalog gains what earns each badge,
copied from app/badges.py at startup like the rest of it.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'd7f2b4e8a913'
down_revision: str | None = 'c6e1a9d4f357'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_badges', sa.Column('featured_position', sa.Integer(), nullable=True))
    op.add_column('badges', sa.Column('how_to_get', sa.String(length=255), server_default='', nullable=False))


def downgrade() -> None:
    op.drop_column('badges', 'how_to_get')
    op.drop_column('user_badges', 'featured_position')
