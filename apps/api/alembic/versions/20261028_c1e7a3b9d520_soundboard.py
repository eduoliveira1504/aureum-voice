"""soundboard: soundboard_sounds, user_settings.soundboard_volume / soundboard_muted, permissions

Revision ID: c1e7a3b9d520
Revises: b0d6f2a8c419
Create Date: 2026-10-28 12:00:00.000000

Block 3.15: each server's Painel de sons. Two permission bits: USE_SOUNDBOARD (1 << 28), which
@everyone has by default; this gives it to the @everyone role of the servers that already exist
(its id is the server's id), and MANAGE_SOUNDBOARD (1 << 29). New table and columns with
defaults: older apps keep working (they just don't show the panel).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c1e7a3b9d520'
down_revision: str | None = 'b0d6f2a8c419'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

USE_SOUNDBOARD = 1 << 28
MANAGE_SOUNDBOARD = 1 << 29


def upgrade() -> None:
    op.create_table(
        'soundboard_sounds',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('server_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=30), nullable=False),
        sa.Column('emoji', sa.String(length=64), nullable=True),
        sa.Column('volume', sa.SmallInteger(), server_default='100', nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=200), nullable=False),
        sa.Column('content_type', sa.String(length=40), nullable=False),
        sa.Column('position', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['server_id'], ['servers.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_soundboard_sounds_server_id'), 'soundboard_sounds', ['server_id'], unique=False)
    op.add_column('user_settings', sa.Column('soundboard_volume', sa.SmallInteger(), server_default='100', nullable=False))
    op.add_column('user_settings', sa.Column('soundboard_muted', sa.Boolean(), server_default='false', nullable=False))
    op.execute(f"UPDATE roles SET permissions = permissions | {USE_SOUNDBOARD} WHERE id = server_id")


def downgrade() -> None:
    bits = USE_SOUNDBOARD | MANAGE_SOUNDBOARD
    op.execute(f"UPDATE roles SET permissions = permissions & ~{bits}::bigint")
    op.execute(
        f"UPDATE channel_permission_overrides SET allow = allow & ~{bits}::bigint, deny = deny & ~{bits}::bigint"
    )
    op.drop_column('user_settings', 'soundboard_muted')
    op.drop_column('user_settings', 'soundboard_volume')
    op.drop_index(op.f('ix_soundboard_sounds_server_id'), table_name='soundboard_sounds')
    op.drop_table('soundboard_sounds')
