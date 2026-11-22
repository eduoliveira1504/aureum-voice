"""addons_category: channel_categories.kind (normal, addons), one addons category per server

Revision ID: e2a8c4f6b719
Revises: d1f7b3c5e598
Create Date: 2026-11-22 12:00:00.000000

Block 4.2.8. Each server gets exactly one "addons" category: addons live there and only they do.
In each server the category named "Addons" (any case; the first one if there are several) becomes
it, or a new one is made at the end if it was renamed or deleted. Text and voice channels inside
it go to "Conversas" and "Salas" (or to no category), and addons outside it move in. Moving keeps
every channel's permissions; it counts as synced only if they match the new category's
(docs/decisions/0037-channel-categories.md). Safe to run twice. Older apps ignore the new field.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'e2a8c4f6b719'
down_revision: str | None = 'd1f7b3c5e598'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _same_overrides(channel: str, category: str) -> str:
    """SQL: the channel's overrides are exactly the category's."""
    columns = "target_type::text, target_id, allow, deny"
    return f"""NOT EXISTS (
        (SELECT {columns} FROM channel_permission_overrides WHERE channel_id = {channel}
         EXCEPT SELECT {columns} FROM channel_category_overrides WHERE category_id = {category})
        UNION ALL
        (SELECT {columns} FROM channel_category_overrides WHERE category_id = {category}
         EXCEPT SELECT {columns} FROM channel_permission_overrides WHERE channel_id = {channel})
    )"""


def _move(where: str, target: str) -> str:
    """Moves the channels matching `where` (alias c, its category alias cat) to `target`, an
    expression over c giving the new category id or NULL."""
    return f"""
    WITH moves AS (
        SELECT c.id, ({target}) AS category_id
        FROM channels c JOIN channel_categories cat ON cat.id = c.category_id
        WHERE {where}
    )
    UPDATE channels ch
    SET category_id = m.category_id,
        permissions_synced = m.category_id IS NOT NULL AND {_same_overrides('ch.id', 'm.category_id')}
    FROM moves m
    WHERE ch.id = m.id
    """


def _named(name: str) -> str:
    return f"""(
        SELECT n.id FROM channel_categories n
        WHERE n.server_id = c.server_id AND n.kind = 'normal' AND lower(btrim(n.name)) = '{name}'
        ORDER BY n.position, n.id LIMIT 1
    )"""


BACKFILL = (
    # The category named "Addons" becomes the addons one.
    """
    UPDATE channel_categories SET kind = 'addons'
    WHERE id IN (
        SELECT DISTINCT ON (server_id) id FROM channel_categories
        WHERE lower(btrim(name)) = 'addons'
        ORDER BY server_id, position, id
    )
    AND server_id NOT IN (SELECT server_id FROM channel_categories WHERE kind = 'addons')
    """,
    # Renamed or deleted: a new one at the end.
    """
    INSERT INTO channel_categories (id, server_id, name, position, kind)
    SELECT gen_random_uuid(), s.id, 'Addons',
           COALESCE((SELECT max(position) + 1 FROM channel_categories c WHERE c.server_id = s.id), 0), 'addons'
    FROM servers s
    WHERE NOT EXISTS (SELECT 1 FROM channel_categories c WHERE c.server_id = s.id AND c.kind = 'addons')
    """,
    # Text and voice channels out of it.
    _move(
        "cat.kind = 'addons' AND c.type::text <> 'addon'",
        f"CASE c.type::text WHEN 'text' THEN {_named('conversas')} WHEN 'voice' THEN {_named('salas')} END",
    ),
    # Addons into it, from other categories.
    _move(
        "cat.kind = 'normal' AND c.type::text = 'addon'",
        "SELECT a.id FROM channel_categories a WHERE a.server_id = c.server_id AND a.kind = 'addons'",
    ),
    # And from no category.
    f"""
    UPDATE channels ch
    SET category_id = a.id, permissions_synced = {_same_overrides('ch.id', 'a.id')}
    FROM channel_categories a
    WHERE ch.category_id IS NULL AND ch.type::text = 'addon' AND ch.server_id IS NOT NULL
      AND a.server_id = ch.server_id AND a.kind = 'addons'
    """,
)


def upgrade() -> None:
    op.add_column('channel_categories', sa.Column('kind', sa.String(length=16), server_default='normal', nullable=False))
    op.create_check_constraint(op.f('ck_channel_categories_category_kind'), 'channel_categories', "kind IN ('normal', 'addons')")
    op.create_index(
        'uq_channel_categories_addons', 'channel_categories', ['server_id'], unique=True, postgresql_where=sa.text("kind = 'addons'")
    )
    for statement in BACKFILL:
        op.execute(statement)


def downgrade() -> None:
    # The moved channels stay where they are now.
    op.drop_index('uq_channel_categories_addons', table_name='channel_categories')
    op.drop_constraint(op.f('ck_channel_categories_category_kind'), 'channel_categories', type_='check')
    op.drop_column('channel_categories', 'kind')
