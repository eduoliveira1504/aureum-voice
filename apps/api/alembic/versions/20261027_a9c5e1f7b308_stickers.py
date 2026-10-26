"""stickers: sticker_packs, stickers, messages.sticker, user_settings.recent_stickers, permissions

Revision ID: a9c5e1f7b308
Revises: d8f4b0a6e297
Create Date: 2026-10-27 12:00:00.000000

Block 3.11 (part C): Aureum's sticker packs (global, added with the CLI) and each server's own
stickers. Two permission bits: MANAGE_EXPRESSIONS (1 << 26) and USE_STICKERS (1 << 27), which
@everyone has by default; this gives it to the @everyone role of the servers that already exist
(its id is the server's id). New tables and columns with defaults: older apps keep working (they
show a sticker message's fallback text).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a9c5e1f7b308'
down_revision: str | None = 'd8f4b0a6e297'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MANAGE_EXPRESSIONS = 1 << 26
USE_STICKERS = 1 << 27


def upgrade() -> None:
    op.create_table(
        'sticker_packs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('is_global', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('server_id', sa.UUID(), nullable=True),
        sa.Column('position', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['server_id'], ['servers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('server_id'),
    )
    op.create_table(
        'stickers',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('pack_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=30), nullable=False),
        sa.Column('emoji', sa.String(length=64), nullable=True),
        sa.Column('key', sa.String(length=200), nullable=False),
        sa.Column('width', sa.Integer(), nullable=False),
        sa.Column('height', sa.Integer(), nullable=False),
        sa.Column('position', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['pack_id'], ['sticker_packs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_stickers_pack_id'), 'stickers', ['pack_id'], unique=False)
    op.add_column('messages', sa.Column('sticker', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column(
        'user_settings',
        sa.Column('recent_stickers', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    )
    op.execute(f"UPDATE roles SET permissions = permissions | {USE_STICKERS} WHERE id = server_id")


def downgrade() -> None:
    bits = MANAGE_EXPRESSIONS | USE_STICKERS
    op.execute(f"UPDATE roles SET permissions = permissions & ~{bits}::bigint")
    op.execute(
        f"UPDATE channel_permission_overrides SET allow = allow & ~{bits}::bigint, deny = deny & ~{bits}::bigint"
    )
    op.drop_column('user_settings', 'recent_stickers')
    op.drop_column('messages', 'sticker')
    op.drop_index(op.f('ix_stickers_pack_id'), table_name='stickers')
    op.drop_table('stickers')
    op.drop_table('sticker_packs')
