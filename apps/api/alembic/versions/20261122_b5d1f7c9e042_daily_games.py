"""daily_games: daily_puzzles and daily_results

Revision ID: b5d1f7c9e042
Revises: a4c0e6b8d931
Create Date: 2026-11-22 23:00:00.000000

Block 4.2.10: the daily games on Home (app/daily). Each day's puzzle is saved the first time it's
asked for, and each person keeps one result per game per day. New tables only.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b5d1f7c9e042'
down_revision: str | None = 'a4c0e6b8d931'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'daily_puzzles',
        sa.Column('game', sa.String(length=16), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('puzzle', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('solution', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('game', 'day', name=op.f('pk_daily_puzzles')),
    )
    op.create_table(
        'daily_results',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('game', sa.String(length=16), nullable=False),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('time_ms', sa.Integer(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('completed', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_daily_results_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'game', 'day', name=op.f('pk_daily_results')),
    )
    op.create_index(op.f('ix_daily_results_day'), 'daily_results', ['day'])


def downgrade() -> None:
    op.drop_index(op.f('ix_daily_results_day'), table_name='daily_results')
    op.drop_table('daily_results')
    op.drop_table('daily_puzzles')
