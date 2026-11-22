"""daily_shares: one daily game challenge per game, day and channel

Revision ID: c6e2a8d0f153
Revises: b5d1f7c9e042
Create Date: 2026-11-23 00:30:00.000000

Block 4.2.10: sharing a daily game's result as a challenge posts a message in a DM, group or
server text channel; this table keeps it to one per game, day and channel (anti-spam). New table.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c6e2a8d0f153'
down_revision: str | None = 'b5d1f7c9e042'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'daily_shares',
        sa.Column('game', sa.String(length=16), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('channel_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], name=op.f('fk_daily_shares_channel_id_channels'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_daily_shares_user_id_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('game', 'day', 'channel_id', name=op.f('pk_daily_shares')),
    )


def downgrade() -> None:
    op.drop_table('daily_shares')
