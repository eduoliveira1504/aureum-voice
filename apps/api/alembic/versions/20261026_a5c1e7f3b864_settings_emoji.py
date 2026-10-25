"""user_settings: emoji_tone, recent_emojis

Revision ID: a5c1e7f3b864
Revises: f4b8d6c2e953
Create Date: 2026-10-26 12:00:00.000000

Block 3.11 (part A): the emoji picker remembers the skin tone and the recently used emojis per
user, on every PC. Columns with defaults: the app's previous version keeps working.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a5c1e7f3b864'
down_revision: str | None = 'f4b8d6c2e953'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('emoji_tone', sa.SmallInteger(), server_default='0', nullable=False))
    op.add_column(
        'user_settings',
        sa.Column('recent_emojis', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'recent_emojis')
    op.drop_column('user_settings', 'emoji_tone')
