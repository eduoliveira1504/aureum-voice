"""notes addon: pages

Revision ID: a7d2f9c4e813
Revises:
Create Date: 2026-10-18 21:10:00.000000

First revision of the "notes" addon branch. New ones: alembic revision --head notes@head -m "..."
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'a7d2f9c4e813'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = ('notes',)
# Addon channels exist from this core revision on.
depends_on: str | Sequence[str] | None = 'e4b81c7a3d56'


def upgrade() -> None:
    op.create_table('addon_notes_pages',
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('content', sa.Text(), server_default='', nullable=False),
    sa.Column('version', sa.Integer(), server_default='0', nullable=False),
    sa.Column('updated_by', sa.UUID(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['updated_by'], ['users.id'], name=op.f('fk_addon_notes_pages_updated_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('workspace_id', name=op.f('pk_addon_notes_pages'))
    )


def downgrade() -> None:
    op.drop_table('addon_notes_pages')
