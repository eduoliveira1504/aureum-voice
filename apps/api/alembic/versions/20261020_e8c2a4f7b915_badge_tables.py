"""badge tables

Revision ID: e8c2a4f7b915
Revises: d3b6f9a1e472
Create Date: 2026-10-20 12:00:00.000000

Badges move from users.badges (a list of keys) to a catalog (badges, filled from app/badges.py
at startup) and grants (user_badges, with an optional number). Existing grants are kept:
"founder" stays, "beta" becomes the numbered "pioneer" in sign-up order.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'e8c2a4f7b915'
down_revision: str | None = 'd3b6f9a1e472'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RARITY = sa.Enum('comum', 'rara', 'lendaria', 'mitica', name='badge_rarity', native_enum=False, create_constraint=True, length=16)


def upgrade() -> None:
    op.create_table('badges',
    sa.Column('id', sa.Integer(), sa.Identity(always=False), nullable=False),
    sa.Column('key', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('description', sa.String(length=255), server_default='', nullable=False),
    sa.Column('icon_svg', sa.Text(), server_default='', nullable=False),
    sa.Column('icon_svg_small', sa.Text(), server_default='', nullable=False),
    sa.Column('rarity', RARITY, nullable=False),
    sa.Column('numbered', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('exclusive_beta', sa.Boolean(), server_default='false', nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_badges')),
    sa.UniqueConstraint('key', name=op.f('uq_badges_key'))
    )
    op.create_table('user_badges',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('badge_id', sa.Integer(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=True),
    sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('granted_by', sa.UUID(), nullable=True),
    sa.ForeignKeyConstraint(['badge_id'], ['badges.id'], name=op.f('fk_user_badges_badge_id_badges'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['granted_by'], ['users.id'], name=op.f('fk_user_badges_granted_by_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_badges_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'badge_id', name=op.f('pk_user_badges')),
    sa.UniqueConstraint('badge_id', 'number', name=op.f('uq_user_badges_badge_id'))
    )
    op.create_index(op.f('ix_user_badges_badge_id'), 'user_badges', ['badge_id'], unique=False)

    # Keep what was granted the old way. The rest of each badge (art, description) comes from
    # app/badges.py when the API starts.
    op.execute("""
        INSERT INTO badges (key, name, rarity, numbered, exclusive_beta) VALUES
            ('founder', 'Fundador', 'mitica', false, true),
            ('pioneer', 'Pioneiro', 'mitica', true, true)
    """)
    op.execute("""
        INSERT INTO user_badges (user_id, badge_id, granted_at)
        SELECT u.id, b.id, u.created_at FROM users u, badges b
        WHERE b.key = 'founder' AND u.badges @> '["founder"]'
    """)
    op.execute("""
        INSERT INTO user_badges (user_id, badge_id, number, granted_at)
        SELECT u.id, b.id, row_number() OVER (ORDER BY u.created_at, u.id), u.created_at
        FROM users u, badges b
        WHERE b.key = 'pioneer' AND u.badges @> '["beta"]'
    """)
    op.drop_column('users', 'badges')


def downgrade() -> None:
    op.add_column('users', sa.Column('badges', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    op.execute("""
        UPDATE users u SET badges = sub.keys FROM (
            SELECT ub.user_id, jsonb_agg(CASE b.key WHEN 'pioneer' THEN 'beta' ELSE b.key END) AS keys
            FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
            WHERE b.key IN ('founder', 'pioneer') GROUP BY ub.user_id
        ) sub WHERE sub.user_id = u.id
    """)
    op.drop_index(op.f('ix_user_badges_badge_id'), table_name='user_badges')
    op.drop_table('user_badges')
    op.drop_table('badges')
