"""roles: EDIT_WHITEBOARD for @everyone

Revision ID: a7c3e1f5b902
Revises: f1b7d3e9a264
Create Date: 2026-10-25 12:00:00.000000

Block 3.9A adds the whiteboard addon and its own permission bit, EDIT_WHITEBOARD (1 << 24),
which @everyone has by default. New servers get it from DEFAULT_EVERYONE; this gives it to the
@everyone role of the servers that already exist (its id is the server's id). Only data
changes, and older apps keep any bit they don't know when they save a role.
"""
from collections.abc import Sequence

from alembic import op

revision: str = 'a7c3e1f5b902'
down_revision: str | None = 'f1b7d3e9a264'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EDIT_WHITEBOARD = 1 << 24


def upgrade() -> None:
    op.execute(f"UPDATE roles SET permissions = permissions | {EDIT_WHITEBOARD} WHERE id = server_id")


def downgrade() -> None:
    # The bit is dropped from every role and override: it means nothing without the addon.
    op.execute(f"UPDATE roles SET permissions = permissions & ~{EDIT_WHITEBOARD}::bigint")
    op.execute(
        f"UPDATE channel_permission_overrides SET allow = allow & ~{EDIT_WHITEBOARD}::bigint, deny = deny & ~{EDIT_WHITEBOARD}::bigint"
    )
