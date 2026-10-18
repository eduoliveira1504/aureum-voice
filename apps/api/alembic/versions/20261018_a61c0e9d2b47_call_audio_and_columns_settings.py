"""call audio, column sizes and muted places settings

Revision ID: a61c0e9d2b47
Revises: f3a9c27d4b18
Create Date: 2026-10-18 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a61c0e9d2b47'
down_revision: str | None = 'f3a9c27d4b18'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('user_audio', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('user_settings', sa.Column('column_sizes', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('user_settings', sa.Column('muted_places', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))


def downgrade() -> None:
    op.drop_column('user_settings', 'muted_places')
    op.drop_column('user_settings', 'column_sizes')
    op.drop_column('user_settings', 'user_audio')
