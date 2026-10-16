"""user status

Revision ID: c5e32e2487e5
Revises: 0b394756abbc
Create Date: 2026-10-16 14:56:29.322213

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c5e32e2487e5'
down_revision: str | None = '0b394756abbc'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('status', sa.Enum('online', 'idle', 'dnd', 'invisible', name='user_status', native_enum=False, create_constraint=True, length=16), server_default='online', nullable=False))


def downgrade() -> None:
    op.drop_column('user_settings', 'status')
