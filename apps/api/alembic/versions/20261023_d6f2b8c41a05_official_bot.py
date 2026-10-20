"""official bot @aureum: actions, welcomes, deliveries, broadcast queue, devices

Revision ID: d6f2b8c41a05
Revises: c4e8a2f1b937
Create Date: 2026-10-23 10:00:00.000000

Phase 3, block 3.3 (app/bot). Every bot action starts off: the CLI switches them on
(`bot enable`). Only adds tables and nullable/defaulted columns, so the app's previous version
keeps working against it.

- bot_actions: on/off and channel per action.
- bot_welcomes: the welcome goes once per user and official server.
- bot_deliveries / bot_outbox: official DMs already sent (never twice) and the broadcast queue.
- user_devices: hashes of app installs that signed in (the "new sign-in" notice). No IP.
- user_settings.official_dm: official DM categories the user turned off.
- channels.is_official: the official DM. messages.official: what @aureum posted.
- bug_reports.dismissed_at: "Fechar (não é bug)".
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'd6f2b8c41a05'
down_revision: str | None = 'c4e8a2f1b937'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'bot_actions',
        sa.Column('action', sa.String(length=32), nullable=False),
        sa.Column('enabled', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('channel_id', sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], name=op.f('fk_bot_actions_channel_id_channels'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('action', name=op.f('pk_bot_actions')),
    )
    op.create_table(
        'bot_welcomes',
        sa.Column('server_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['server_id'], ['servers.id'], name=op.f('fk_bot_welcomes_server_id_servers'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_bot_welcomes_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('server_id', 'user_id', name=op.f('pk_bot_welcomes')),
    )
    op.create_table(
        'bot_deliveries',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_bot_deliveries_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'key', name=op.f('pk_bot_deliveries')),
    )
    op.create_table(
        'bot_outbox',
        sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('category', sa.String(length=16), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_bot_outbox_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_bot_outbox')),
        sa.UniqueConstraint('user_id', 'key', name=op.f('uq_bot_outbox_user_id')),
    )
    op.create_index('ix_bot_outbox_due', 'bot_outbox', ['id'], unique=False, postgresql_where=sa.text('sent_at IS NULL'))
    op.create_table(
        'user_devices',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('device_hash', sa.String(length=64), nullable=False),
        sa.Column('first_seen', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_devices_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'device_hash', name=op.f('pk_user_devices')),
    )
    op.add_column('user_settings', sa.Column('official_dm', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('channels', sa.Column('is_official', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('messages', sa.Column('official', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('bug_reports', sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('bug_reports', 'dismissed_at')
    op.drop_column('messages', 'official')
    op.drop_column('channels', 'is_official')
    op.drop_column('user_settings', 'official_dm')
    op.drop_table('user_devices')
    op.drop_index('ix_bot_outbox_due', table_name='bot_outbox', postgresql_where=sa.text('sent_at IS NULL'))
    op.drop_table('bot_outbox')
    op.drop_table('bot_deliveries')
    op.drop_table('bot_welcomes')
    op.drop_table('bot_actions')
