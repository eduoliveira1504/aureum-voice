"""private calls

Revision ID: 0b394756abbc
Revises: e7a3b5d1c802
Create Date: 2026-10-16 14:48:57.420058

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0b394756abbc'
down_revision: str | None = 'e7a3b5d1c802'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('calls',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('channel_id', sa.UUID(), nullable=False),
    sa.Column('started_by', sa.UUID(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], name=op.f('fk_calls_channel_id_channels'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['started_by'], ['users.id'], name=op.f('fk_calls_started_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_calls'))
    )
    op.create_index(op.f('ix_calls_channel_id'), 'calls', ['channel_id'], unique=False)
    op.create_index('uq_calls_active_channel', 'calls', ['channel_id'], unique=True, postgresql_where=sa.text('ended_at IS NULL'))
    op.create_table('call_participants',
    sa.Column('call_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('rung_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('joined_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('left_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('declined_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['call_id'], ['calls.id'], name=op.f('fk_call_participants_call_id_calls'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_call_participants_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('call_id', 'user_id', name=op.f('pk_call_participants'))
    )
    op.create_index(op.f('ix_call_participants_user_id'), 'call_participants', ['user_id'], unique=False)
    op.add_column('messages', sa.Column('call_id', sa.UUID(), nullable=True))
    op.create_foreign_key(op.f('fk_messages_call_id_calls'), 'messages', 'calls', ['call_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint(op.f('fk_messages_call_id_calls'), 'messages', type_='foreignkey')
    op.drop_column('messages', 'call_id')
    op.drop_index(op.f('ix_call_participants_user_id'), table_name='call_participants')
    op.drop_table('call_participants')
    op.drop_index('uq_calls_active_channel', table_name='calls', postgresql_where=sa.text('ended_at IS NULL'))
    op.drop_index(op.f('ix_calls_channel_id'), table_name='calls')
    op.drop_table('calls')
