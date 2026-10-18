"""member nicknames

Revision ID: b83f4d1a6c20
Revises: a61c0e9d2b47
Create Date: 2026-10-18 12:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'b83f4d1a6c20'
down_revision: str | None = 'a61c0e9d2b47'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('server_members', sa.Column('nickname', sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column('server_members', 'nickname')
