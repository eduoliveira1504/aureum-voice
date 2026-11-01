"""channel categories: channel_categories, channels.category_id / permissions_synced

Revision ID: d2f8b4c0e631
Revises: c1e7a3b9d520
Create Date: 2026-11-01 12:00:00.000000

Block 3.12. Every existing server gets the three sections the sidebar already shows as categories
("Salas", "Conversas", "Addons") holding today's channels in the same order, so nothing changes on
screen. A channel that already has its own permissions starts out of sync with its category.
New table and nullable column: older apps keep working (they ignore both).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'd2f8b4c0e631'
down_revision: str | None = 'c1e7a3b9d520'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Only for servers without categories, so it's safe to run twice.
BACKFILL = (
    """
    INSERT INTO channel_categories (id, server_id, name, position)
    SELECT gen_random_uuid(), s.id, v.name, v.position
    FROM servers s
    CROSS JOIN (VALUES ('Salas', 0), ('Conversas', 1), ('Addons', 2)) AS v(name, position)
    WHERE NOT EXISTS (SELECT 1 FROM channel_categories c WHERE c.server_id = s.id)
    """,
    """
    UPDATE channels c SET category_id = cat.id
    FROM channel_categories cat
    WHERE c.server_id = cat.server_id
      AND c.category_id IS NULL
      AND cat.name = CASE c.type::text WHEN 'voice' THEN 'Salas' WHEN 'text' THEN 'Conversas' WHEN 'addon' THEN 'Addons' END
    """,
    """
    UPDATE channels SET permissions_synced = false
    WHERE id IN (SELECT channel_id FROM channel_permission_overrides)
    """,
)


def upgrade() -> None:
    op.create_table(
        'channel_categories',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('server_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('position', sa.Integer(), server_default='0', nullable=False),
        sa.ForeignKeyConstraint(['server_id'], ['servers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_channel_categories_server_id'), 'channel_categories', ['server_id'])
    op.add_column('channels', sa.Column('category_id', sa.UUID(), nullable=True))
    op.add_column('channels', sa.Column('permissions_synced', sa.Boolean(), server_default='true', nullable=False))
    op.create_index(op.f('ix_channels_category_id'), 'channels', ['category_id'])
    op.create_foreign_key(
        op.f('fk_channels_category_id_channel_categories'), 'channels', 'channel_categories', ['category_id'], ['id'], ondelete='SET NULL'
    )
    for statement in BACKFILL:
        op.execute(statement)


def downgrade() -> None:
    op.drop_constraint(op.f('fk_channels_category_id_channel_categories'), 'channels', type_='foreignkey')
    op.drop_index(op.f('ix_channels_category_id'), table_name='channels')
    op.drop_column('channels', 'permissions_synced')
    op.drop_column('channels', 'category_id')
    op.drop_index(op.f('ix_channel_categories_server_id'), table_name='channel_categories')
    op.drop_table('channel_categories')
