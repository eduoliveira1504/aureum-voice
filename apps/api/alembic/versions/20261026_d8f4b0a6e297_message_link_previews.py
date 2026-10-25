"""messages: link_previews, previews_removed

Revision ID: d8f4b0a6e297
Revises: c7e3a9f5d186
Create Date: 2026-10-26 19:00:00.000000

Block 3.11 (part B): cards of the links in a message, filled by the API after it's sent, and
whether its author removed them. Columns with defaults: the app's previous version ignores them.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'd8f4b0a6e297'
down_revision: str | None = 'c7e3a9f5d186'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'messages',
        sa.Column('link_previews', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    )
    op.add_column('messages', sa.Column('previews_removed', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('messages', 'previews_removed')
    op.drop_column('messages', 'link_previews')
