"""attachments

Revision ID: a7d2c4e9f318
Revises: f1c3a8d6b072
Create Date: 2026-10-19 10:00:00.000000

Files sent in conversations (see docs/decisions/0015-attachments-and-background.md).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'a7d2c4e9f318'
down_revision: str | None = 'f1c3a8d6b072'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'attachments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('channel_id', sa.UUID(), nullable=False),
        sa.Column('message_id', sa.BigInteger(), nullable=True),
        sa.Column('uploader_id', sa.UUID(), nullable=True),
        sa.Column('key', sa.String(length=200), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column(
            'kind',
            sa.Enum('image', 'video', 'file', name='attachment_kind', native_enum=False, create_constraint=True, length=16),
            nullable=False,
        ),
        sa.Column('content_type', sa.String(length=100), nullable=False),
        sa.Column('size', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], name=op.f('fk_attachments_channel_id_channels'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], name=op.f('fk_attachments_message_id_messages'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploader_id'], ['users.id'], name=op.f('fk_attachments_uploader_id_users'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_attachments')),
    )
    op.create_index(op.f('ix_attachments_channel_id'), 'attachments', ['channel_id'], unique=False)
    op.create_index(op.f('ix_attachments_message_id'), 'attachments', ['message_id'], unique=False)
    op.create_index(op.f('ix_attachments_uploader_id'), 'attachments', ['uploader_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_attachments_uploader_id'), table_name='attachments')
    op.drop_index(op.f('ix_attachments_message_id'), table_name='attachments')
    op.drop_index(op.f('ix_attachments_channel_id'), table_name='attachments')
    op.drop_table('attachments')
