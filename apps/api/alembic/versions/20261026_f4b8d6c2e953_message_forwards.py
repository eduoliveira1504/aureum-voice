"""messages: forwarded_from

Revision ID: f4b8d6c2e953
Revises: e3a9c5b1d742
Create Date: 2026-10-26 11:00:00.000000

Block 3.11 (part A): a forwarded message keeps a snapshot of the original (content, when it was
sent and where from), not a live link, so it stays when the original is deleted.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'f4b8d6c2e953'
down_revision: str | None = 'e3a9c5b1d742'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('forwarded_from', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'forwarded_from')
