"""addon channels

Revision ID: e4b81c7a3d56
Revises: d9e4a7b2f150
Create Date: 2026-10-18 21:00:00.000000

Addons' own tables live in their own Alembic branches (app/addons/<key>/migrations), which
depend on this revision. See docs/decisions/0013-addon-framework.md.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'e4b81c7a3d56'
down_revision: str | None = 'd9e4a7b2f150'
branch_labels: str | Sequence[str] | None = ('core',)
depends_on: str | Sequence[str] | None = None

OLD_TYPES = "'text', 'voice', 'dm', 'group_dm'"
NEW_TYPES = "'text', 'voice', 'dm', 'group_dm', 'addon'"


def upgrade() -> None:
    op.drop_constraint(op.f('ck_channels_channel_type'), 'channels', type_='check')
    op.create_check_constraint(op.f('ck_channels_channel_type'), 'channels', f"type IN ({NEW_TYPES})")
    op.add_column('channels', sa.Column('addon_key', sa.String(length=32), nullable=True))
    op.add_column('channels', sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.create_check_constraint(op.f('ck_channels_addon_key'), 'channels', "(type = 'addon') = (addon_key IS NOT NULL)")


def downgrade() -> None:
    op.execute("DELETE FROM channels WHERE type = 'addon'")
    op.drop_constraint(op.f('ck_channels_addon_key'), 'channels', type_='check')
    op.drop_column('channels', 'config')
    op.drop_column('channels', 'addon_key')
    op.drop_constraint(op.f('ck_channels_channel_type'), 'channels', type_='check')
    op.create_check_constraint(op.f('ck_channels_channel_type'), 'channels', f"type IN ({OLD_TYPES})")
