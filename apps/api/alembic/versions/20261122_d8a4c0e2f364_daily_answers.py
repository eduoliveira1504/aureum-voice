"""daily_answers: daily_results.answer, how each person solved it

Revision ID: d8a4c0e2f364
Revises: c6e2a8d0f153
Create Date: 2026-11-23 01:00:00.000000

Block 4.2.10: "Ver jogo" after solving shows the board as the person solved it, so the answer the
API accepted is kept with the result (only its owner gets it back). Nullable column only.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'd8a4c0e2f364'
down_revision: str | None = 'c6e2a8d0f153'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('daily_results', sa.Column('answer', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('daily_results', 'answer')
