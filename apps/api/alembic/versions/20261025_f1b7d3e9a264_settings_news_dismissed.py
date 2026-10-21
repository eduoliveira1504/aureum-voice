"""user_settings: dismissed Novidades version

Revision ID: f1b7d3e9a264
Revises: e3a9c5d7f182
Create Date: 2026-10-25 10:00:00.000000

The Home hub (Início) shows a "Novidades do Aureum" card that can be dismissed until the next
app version; the dismissed version is kept per user so it holds on every PC. Only adds a
nullable column, so the app's previous version keeps working against it.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'f1b7d3e9a264'
down_revision: str | None = 'e3a9c5d7f182'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('news_dismissed', sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column('user_settings', 'news_dismissed')
