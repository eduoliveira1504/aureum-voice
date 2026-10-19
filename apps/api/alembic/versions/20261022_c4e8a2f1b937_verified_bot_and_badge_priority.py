"""verified and bot accounts, badge priority

Revision ID: c4e8a2f1b937
Revises: a7d2e9c4b113
Create Date: 2026-10-22 10:00:00.000000

Replaces the "Oficial" seal: a gold check (is_verified) and a "BOT" tag (is_bot) next to the
name. The CLI's --oficial sets both; existing official accounts are updated with
`users update --oficial`, not here. Badges get a fixed priority that breaks ties within a rarity
(the app shows the two rarest next to a name); the API fills it from app/badges.py at startup.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c4e8a2f1b937'
down_revision: str | None = 'a7d2e9c4b113'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_verified', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('is_bot', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('badges', sa.Column('priority', sa.Integer(), server_default='100', nullable=False))


def downgrade() -> None:
    op.drop_column('badges', 'priority')
    op.drop_column('users', 'is_bot')
    op.drop_column('users', 'is_verified')
