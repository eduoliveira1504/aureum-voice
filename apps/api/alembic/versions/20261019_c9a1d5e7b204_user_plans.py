"""user plans

Revision ID: c9a1d5e7b204
Revises: b4e8f1a2c693
Create Date: 2026-10-19 15:00:00.000000

Every user has a plan ('free' for everyone now); it picks the media tier the voice token hands out.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c9a1d5e7b204'
down_revision: str | None = 'b4e8f1a2c693'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('plan', sa.Enum('free', name='user_plan', native_enum=False, create_constraint=True, length=16), server_default='free', nullable=False))


def downgrade() -> None:
    op.drop_column('users', 'plan')
