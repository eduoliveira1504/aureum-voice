"""collapsed categories: user_settings.collapsed_categories

Revision ID: f4b0d6e2a853
Revises: e3a9c5d1f742
Create Date: 2026-11-01 14:00:00.000000

Block 3.12: which categories each person keeps collapsed. Column with a default: older apps ignore it.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'f4b0d6e2a853'
down_revision: str | None = 'e3a9c5d1f742'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('collapsed_categories', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))


def downgrade() -> None:
    op.drop_column('user_settings', 'collapsed_categories')
