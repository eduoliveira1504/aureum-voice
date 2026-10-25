"""polls addon: polls, options and votes

Revision ID: d5a9e3c7f164
Revises:
Create Date: 2026-10-25 18:30:00.000000

First revision of the "polls" addon branch. New ones: alembic revision --head polls@head -m "..."
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'd5a9e3c7f164'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = ('polls',)
# A poll is shown by a message that carries it (messages.embed) from this core revision on.
depends_on: str | Sequence[str] | None = 'b8d4f2a6c731'


def upgrade() -> None:
    op.create_table('addon_polls_polls',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('message_id', sa.BigInteger(), nullable=False),
    sa.Column('question', sa.String(length=300), nullable=False),
    sa.Column('multiple', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('anonymous', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('closes_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('closed_by', sa.UUID(), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['closed_by'], ['users.id'], name=op.f('fk_addon_polls_polls_closed_by_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_addon_polls_polls_created_by_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['message_id'], ['messages.id'], name=op.f('fk_addon_polls_polls_message_id_messages'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_polls_polls')),
    sa.UniqueConstraint('message_id', name=op.f('uq_addon_polls_polls_message_id'))
    )
    op.create_index(op.f('ix_addon_polls_polls_workspace_id'), 'addon_polls_polls', ['workspace_id'], unique=False)
    op.create_index('ix_addon_polls_polls_due', 'addon_polls_polls', ['closes_at'], unique=False, postgresql_where='closed_at IS NULL AND closes_at IS NOT NULL')
    op.create_table('addon_polls_options',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('poll_id', sa.UUID(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('text', sa.String(length=80), nullable=False),
    sa.Column('emoji', sa.String(length=16), nullable=True),
    sa.ForeignKeyConstraint(['poll_id'], ['addon_polls_polls.id'], name=op.f('fk_addon_polls_options_poll_id_addon_polls_polls'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_polls_options'))
    )
    op.create_index(op.f('ix_addon_polls_options_poll_id'), 'addon_polls_options', ['poll_id'], unique=False)
    op.create_table('addon_polls_votes',
    sa.Column('option_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('poll_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['option_id'], ['addon_polls_options.id'], name=op.f('fk_addon_polls_votes_option_id_addon_polls_options'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['poll_id'], ['addon_polls_polls.id'], name=op.f('fk_addon_polls_votes_poll_id_addon_polls_polls'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_addon_polls_votes_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('option_id', 'user_id', name=op.f('pk_addon_polls_votes'))
    )
    op.create_index('ix_addon_polls_votes_poll_id_user_id', 'addon_polls_votes', ['poll_id', 'user_id'], unique=False)


def downgrade() -> None:
    op.drop_table('addon_polls_votes')
    op.drop_table('addon_polls_options')
    op.drop_table('addon_polls_polls')
