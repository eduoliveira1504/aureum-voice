"""screen audio: user_settings.screen_audio / screen_volume_default

Revision ID: a7c3e9f1b264
Revises: f4b0d6e2a853
Create Date: 2026-11-08 12:00:00.000000

Block 3.24 C: how loud each person's screen share plays for the user, saved per user id (like
user_audio), and the volume for people never adjusted (50%). Columns with defaults: older apps
keep working (they keep the volume in memory, as before).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a7c3e9f1b264'
down_revision: str | None = 'f4b0d6e2a853'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'user_settings',
        sa.Column('screen_audio', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    )
    op.add_column('user_settings', sa.Column('screen_volume_default', sa.SmallInteger(), server_default='50', nullable=False))


def downgrade() -> None:
    op.drop_column('user_settings', 'screen_volume_default')
    op.drop_column('user_settings', 'screen_audio')
