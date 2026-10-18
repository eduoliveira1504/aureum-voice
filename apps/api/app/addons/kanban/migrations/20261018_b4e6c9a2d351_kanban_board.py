"""kanban addon: board

Revision ID: b4e6c9a2d351
Revises:
Create Date: 2026-10-18 23:10:00.000000

First revision of the "kanban" addon branch. New ones: alembic revision --head kanban@head -m "..."
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b4e6c9a2d351'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = ('kanban',)
# Addon channels exist from this core revision on.
depends_on: str | Sequence[str] | None = 'e4b81c7a3d56'


def upgrade() -> None:
    op.create_table('addon_kanban_columns',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('stage', sa.String(length=8), server_default='todo', nullable=False),
    sa.Column('position', sa.Integer(), server_default='0', nullable=False),
    sa.CheckConstraint("stage IN ('todo', 'doing', 'done')", name=op.f('ck_addon_kanban_columns_stage')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_kanban_columns'))
    )
    op.create_index(op.f('ix_addon_kanban_columns_workspace_id'), 'addon_kanban_columns', ['workspace_id'], unique=False)
    op.create_table('addon_kanban_labels',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=30), nullable=False),
    sa.Column('color', sa.String(length=12), server_default='gray', nullable=False),
    sa.CheckConstraint("color IN ('gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink')", name=op.f('ck_addon_kanban_labels_color')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_kanban_labels'))
    )
    op.create_index(op.f('ix_addon_kanban_labels_workspace_id'), 'addon_kanban_labels', ['workspace_id'], unique=False)
    op.create_table('addon_kanban_cards',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('column_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), server_default='', nullable=False),
    sa.Column('assignee_id', sa.UUID(), nullable=True),
    sa.Column('label_ids', postgresql.ARRAY(sa.UUID()), server_default='{}', nullable=False),
    sa.Column('due_date', sa.Date(), nullable=True),
    sa.Column('position', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], name=op.f('fk_addon_kanban_cards_assignee_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['column_id'], ['addon_kanban_columns.id'], name=op.f('fk_addon_kanban_cards_column_id_addon_kanban_columns'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_addon_kanban_cards_created_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_kanban_cards'))
    )
    op.create_index(op.f('ix_addon_kanban_cards_column_id'), 'addon_kanban_cards', ['column_id'], unique=False)
    op.create_index(op.f('ix_addon_kanban_cards_workspace_id'), 'addon_kanban_cards', ['workspace_id'], unique=False)
    op.create_table('addon_kanban_events',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('card_id', sa.UUID(), nullable=True),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('action', sa.String(length=24), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_addon_kanban_events_actor_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_kanban_events'))
    )
    op.create_index('ix_addon_kanban_events_card_id_id', 'addon_kanban_events', ['card_id', 'id'], unique=False)
    op.create_index('ix_addon_kanban_events_workspace_id_id', 'addon_kanban_events', ['workspace_id', 'id'], unique=False)


def downgrade() -> None:
    op.drop_table('addon_kanban_events')
    op.drop_table('addon_kanban_cards')
    op.drop_table('addon_kanban_labels')
    op.drop_table('addon_kanban_columns')
