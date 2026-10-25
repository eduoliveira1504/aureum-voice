"""whiteboard addon: boards, versions and files

Revision ID: c2d8f4a6e310
Revises:
Create Date: 2026-10-25 13:00:00.000000

First revision of the "whiteboard" addon branch. New ones: alembic revision --head whiteboard@head -m "..."
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'c2d8f4a6e310'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = ('whiteboard',)
# Addon channels exist from this core revision on.
depends_on: str | Sequence[str] | None = 'e4b81c7a3d56'


def upgrade() -> None:
    op.create_table('addon_whiteboard_boards',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('elements', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('background', sa.String(length=8), server_default='plain', nullable=False),
    sa.Column('version', sa.Integer(), server_default='0', nullable=False),
    sa.Column('scene_bytes', sa.Integer(), server_default='0', nullable=False),
    sa.Column('thumbnail_key', sa.String(length=200), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('updated_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('snapshot_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("background IN ('plain', 'grid')", name=op.f('ck_addon_whiteboard_boards_background')),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], name=op.f('fk_addon_whiteboard_boards_created_by_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['updated_by'], ['users.id'], name=op.f('fk_addon_whiteboard_boards_updated_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_whiteboard_boards'))
    )
    op.create_index(op.f('ix_addon_whiteboard_boards_workspace_id'), 'addon_whiteboard_boards', ['workspace_id'], unique=False)
    op.create_table('addon_whiteboard_snapshots',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('board_id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('elements', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('background', sa.String(length=8), nullable=False),
    sa.Column('author_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('fk_addon_whiteboard_snapshots_author_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['board_id'], ['addon_whiteboard_boards.id'], name=op.f('fk_addon_whiteboard_snapshots_board_id_addon_whiteboard_boards'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_addon_whiteboard_snapshots'))
    )
    op.create_index('ix_addon_whiteboard_snapshots_board_id_id', 'addon_whiteboard_snapshots', ['board_id', 'id'], unique=False)
    op.create_index(op.f('ix_addon_whiteboard_snapshots_workspace_id'), 'addon_whiteboard_snapshots', ['workspace_id'], unique=False)
    op.create_table('addon_whiteboard_files',
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('file_id', sa.String(length=64), nullable=False),
    sa.Column('key', sa.String(length=200), nullable=False),
    sa.Column('content_type', sa.String(length=40), nullable=False),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('uploaded_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['uploaded_by'], ['users.id'], name=op.f('fk_addon_whiteboard_files_uploaded_by_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('workspace_id', 'file_id', name=op.f('pk_addon_whiteboard_files'))
    )


def downgrade() -> None:
    op.drop_table('addon_whiteboard_files')
    op.drop_table('addon_whiteboard_snapshots')
    op.drop_table('addon_whiteboard_boards')
