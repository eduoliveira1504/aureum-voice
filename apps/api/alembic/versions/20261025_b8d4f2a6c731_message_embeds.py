"""messages: embed (addons that live in chats)

Revision ID: b8d4f2a6c731
Revises: a7c3e1f5b902
Create Date: 2026-10-25 18:00:00.000000

Block 3.9B adds polls, the first addon that lives in a chat instead of an addon channel. Its
message carries {"addon_key", "id"} in this column; older apps ignore it and show the content.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b8d4f2a6c731'
down_revision: str | None = 'a7c3e1f5b902'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('embed', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'embed')
