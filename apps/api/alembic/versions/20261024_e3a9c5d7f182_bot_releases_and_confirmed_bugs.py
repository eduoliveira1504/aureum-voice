"""bot: announced releases and confirmed bug reports

Revision ID: e3a9c5d7f182
Revises: d6f2b8c41a05
Create Date: 2026-10-24 10:00:00.000000

The bot goes fully automatic (app/bot): it announces each new app release published on GitHub
once (bot_releases) and says in the bugs channel when a report is confirmed
(bug_reports.confirmed_at). Only adds a table and a nullable column, so the app's previous
version keeps working against it.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'e3a9c5d7f182'
down_revision: str | None = 'd6f2b8c41a05'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'bot_releases',
        sa.Column('tag', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('tag', name=op.f('pk_bot_releases')),
    )
    op.add_column('bug_reports', sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('bug_reports', 'confirmed_at')
    op.drop_table('bot_releases')
