"""addon announcements

Revision ID: f1c3a8d6b072
Revises: e4b81c7a3d56
Create Date: 2026-10-18 23:00:00.000000

An addon channel can name a text channel where its addon posts system lines (the Kanban board's
"moved a card"), and messages can be such lines. See docs/decisions/0014-kanban-addon.md.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'f1c3a8d6b072'
down_revision: str | None = 'e4b81c7a3d56'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('channels', sa.Column('announce_channel_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f('fk_channels_announce_channel_id_channels'), 'channels', 'channels',
        ['announce_channel_id'], ['id'], ondelete='SET NULL',
    )
    op.add_column('messages', sa.Column('system', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'system')
    op.drop_constraint(op.f('fk_channels_announce_channel_id_channels'), 'channels', type_='foreignkey')
    op.drop_column('channels', 'announce_channel_id')
