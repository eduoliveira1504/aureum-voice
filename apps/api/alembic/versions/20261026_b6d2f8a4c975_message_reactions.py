"""message_reactions

Revision ID: b6d2f8a4c975
Revises: a5c1e7f3b864
Create Date: 2026-10-26 13:00:00.000000

Block 3.11 (part A): emoji reactions under messages, one row per (message, user, emoji). The
primary key starts with message_id, which covers loading a page's reactions.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'b6d2f8a4c975'
down_revision: str | None = 'a5c1e7f3b864'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'message_reactions',
        sa.Column('message_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('emoji', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], name=op.f('fk_message_reactions_message_id_messages'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_message_reactions_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('message_id', 'user_id', 'emoji', name=op.f('pk_message_reactions')),
    )


def downgrade() -> None:
    op.drop_table('message_reactions')
