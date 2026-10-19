"""bug reports

Revision ID: d3b6f9a1e472
Revises: c9a1d5e7b204
Create Date: 2026-10-20 10:00:00.000000

Problems reported from the app ("Reportar problema"), read by the app owner.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'd3b6f9a1e472'
down_revision: str | None = 'c9a1d5e7b204'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('bug_reports',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('author_id', sa.UUID(), nullable=True),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('app_version', sa.String(length=32), nullable=False),
    sa.Column('os', sa.String(length=100), nullable=False),
    sa.Column('logs', sa.Text(), server_default='', nullable=False),
    sa.Column('screenshot_key', sa.String(length=200), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('fk_bug_reports_author_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_bug_reports'))
    )
    op.create_index(op.f('ix_bug_reports_author_id'), 'bug_reports', ['author_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_bug_reports_author_id'), table_name='bug_reports')
    op.drop_table('bug_reports')
