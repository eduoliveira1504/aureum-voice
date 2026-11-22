"""daily_hints: daily_results.hints, hints asked for while playing

Revision ID: e9b5d1f3a475
Revises: d8a4c0e2f364
Create Date: 2026-11-23 02:00:00.000000

Block 4.2.10: a hint every 30 seconds (where a word begins, the Trilha's next step, a Sudoku number).
How many were used is kept with the result and shown next to the time. Column with a default.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'e9b5d1f3a475'
down_revision: str | None = 'd8a4c0e2f364'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('daily_results', sa.Column('hints', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    op.drop_column('daily_results', 'hints')
