"""category overrides: channel_category_overrides

Revision ID: e3a9c5d1f742
Revises: d2f8b4c0e631
Create Date: 2026-11-01 13:00:00.000000

Block 3.12: a category's permissions, copied to the channels that follow it. New table; nothing
that already exists changes.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'e3a9c5d1f742'
down_revision: str | None = 'd2f8b4c0e631'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'channel_category_overrides',
        sa.Column('category_id', sa.UUID(), nullable=False),
        sa.Column('target_type', sa.Enum('role', 'member', name='category_override_target', native_enum=False, create_constraint=True, length=16), nullable=False),
        sa.Column('target_id', sa.UUID(), nullable=False),
        sa.Column('allow', sa.BigInteger(), server_default='0', nullable=False),
        sa.Column('deny', sa.BigInteger(), server_default='0', nullable=False),
        sa.ForeignKeyConstraint(['category_id'], ['channel_categories.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('category_id', 'target_type', 'target_id'),
    )


def downgrade() -> None:
    op.drop_table('channel_category_overrides')
