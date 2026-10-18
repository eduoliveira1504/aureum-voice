"""rich profiles

Revision ID: d9e4a7b2f150
Revises: c2d7e5f0a913
Create Date: 2026-10-18 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'd9e4a7b2f150'
down_revision: str | None = 'c2d7e5f0a913'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('pronouns', sa.String(length=40), nullable=True))
    op.add_column('users', sa.Column('custom_status', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('users', sa.Column('avatar_frame', sa.String(length=16), server_default='none', nullable=False))
    op.add_column('users', sa.Column('favorite_song', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('users', sa.Column('links', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    op.add_column('users', sa.Column('badges', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))


def downgrade() -> None:
    op.drop_column('users', 'badges')
    op.drop_column('users', 'links')
    op.drop_column('users', 'favorite_song')
    op.drop_column('users', 'avatar_frame')
    op.drop_column('users', 'custom_status')
    op.drop_column('users', 'pronouns')
