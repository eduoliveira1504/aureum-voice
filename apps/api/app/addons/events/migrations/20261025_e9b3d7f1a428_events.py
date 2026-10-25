"""events addon: events and answers

Revision ID: e9b3d7f1a428
Revises:
Create Date: 2026-10-25 21:00:00.000000

First revision of the "events" addon branch. New ones: alembic revision --head events@head -m "..."
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'e9b3d7f1a428'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = ('events',)
# Addon channels exist from this core revision on.
depends_on: str | Sequence[str] | None = 'e4b81c7a3d56'


def upgrade() -> None:
    op.create_table('addon_events_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), server_default='', nullable=False),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('repeat', sa.String(length=8), server_default='none', nullable=False),
    sa.Column('location_channel_id', sa.UUID(), nullable=True),
    sa.Column('location_text', sa.String(length=200), nullable=True),
    sa.Column('cover_key', sa.String(length=200), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("repeat IN ('none', 'weekly')", name=op.f('ck_addon_events_events_repeat')),
    sa.CheckConstraint('ends_at > starts_at', name=op.f('ck_addon_events_events_ends_after_start')),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_addon_events_events_created_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_events_events'))
    )
    op.create_index(op.f('ix_addon_events_events_workspace_id'), 'addon_events_events', ['workspace_id'], unique=False)
    op.create_table('addon_events_responses',
    sa.Column('event_id', sa.UUID(), nullable=False),
    sa.Column('occurrence', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('going', 'maybe', 'no')", name=op.f('ck_addon_events_responses_status')),
    sa.ForeignKeyConstraint(['event_id'], ['addon_events_events.id'], name=op.f('fk_addon_events_responses_event_id_addon_events_events'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_addon_events_responses_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('event_id', 'occurrence', 'user_id', name=op.f('pk_addon_events_responses'))
    )


def downgrade() -> None:
    op.drop_table('addon_events_responses')
    op.drop_table('addon_events_events')
