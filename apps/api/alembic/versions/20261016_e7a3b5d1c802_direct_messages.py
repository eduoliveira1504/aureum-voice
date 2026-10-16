"""direct messages

Revision ID: e7a3b5d1c802
Revises: d41f7a2c9e15
Create Date: 2026-10-16 20:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'e7a3b5d1c802'
down_revision: str | None = 'd41f7a2c9e15'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('channel_members',
    sa.Column('channel_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('hidden', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], name=op.f('fk_channel_members_channel_id_channels'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_channel_members_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('channel_id', 'user_id', name=op.f('pk_channel_members'))
    )
    op.create_index(op.f('ix_channel_members_user_id'), 'channel_members', ['user_id'], unique=False)
    op.add_column('channels', sa.Column('dm_key', sa.String(length=73), nullable=True))
    op.create_unique_constraint(op.f('uq_channels_dm_key'), 'channels', ['dm_key'])


def downgrade() -> None:
    op.drop_constraint(op.f('uq_channels_dm_key'), 'channels', type_='unique')
    op.drop_column('channels', 'dm_key')
    op.drop_index(op.f('ix_channel_members_user_id'), table_name='channel_members')
    op.drop_table('channel_members')
