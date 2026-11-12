"""server_type: servers.type (game, work, mixed), locked after creation

Revision ID: c9e5a1b3d486
Revises: b8d4f0a2c375
Create Date: 2026-11-12 12:00:00.000000

Block 4.2.1: each server has a type that decides which addons it can have (app/server_types.py).
Servers that exist before this migration become "mixed", which allows every addon, so nothing
disappears for anyone. The server default stays so older code paths that don't send a type keep
working (the API also defaults to mixed).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c9e5a1b3d486'
down_revision: str | None = 'b8d4f0a2c375'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('servers', sa.Column('type', sa.String(length=16), server_default='mixed', nullable=False))
    op.create_check_constraint(op.f('ck_servers_server_type'), 'servers', "type IN ('game', 'work', 'mixed')")


def downgrade() -> None:
    op.drop_constraint(op.f('ck_servers_server_type'), 'servers', type_='check')
    op.drop_column('servers', 'type')
