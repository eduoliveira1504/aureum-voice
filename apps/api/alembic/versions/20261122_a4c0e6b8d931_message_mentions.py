"""message_mentions: messages.mentions, who a message notified

Revision ID: a4c0e6b8d931
Revises: f3b9d5a7c820
Create Date: 2026-11-22 21:00:00.000000

Mentions of roles, @all and @here (app/reads.py): who got notified can't be read back from the
text (@here depends on who was online), so it's kept on the message for Home's list of mentions.
Nullable and not backfilled: older messages keep being matched by the @names in their text.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a4c0e6b8d931'
down_revision: str | None = 'f3b9d5a7c820'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('mentions', postgresql.ARRAY(sa.UUID()), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'mentions')
