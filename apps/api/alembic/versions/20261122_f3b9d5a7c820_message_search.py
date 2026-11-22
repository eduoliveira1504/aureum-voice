"""message_search: a full text index on messages.content (Portuguese config)

Revision ID: f3b9d5a7c820
Revises: e2a8c4f6b719
Create Date: 2026-11-22 18:00:00.000000

Block 4.2.4: search inside a server (app/routers/search.py) uses Postgres' own full text search,
no new service. The expression must match the one the route queries for the index to be used.
Only an index: older apps and the data are untouched.
"""
from collections.abc import Sequence

from alembic import op

revision: str = 'f3b9d5a7c820'
down_revision: str | None = 'e2a8c4f6b719'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_messages_content_search ON messages USING gin (to_tsvector('portuguese', content))")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_messages_content_search")
