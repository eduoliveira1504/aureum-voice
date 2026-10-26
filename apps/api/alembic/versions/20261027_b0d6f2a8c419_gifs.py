"""gifs: messages.gif, gif_favorites

Revision ID: b0d6f2a8c419
Revises: a9c5e1f7b308
Create Date: 2026-10-27 15:00:00.000000

Block 3.11 (part C): GIF messages from Klipy (the provider's URLs as given, never the file) and
each user's favorite GIFs. A nullable column and a new table: older apps keep working (they show
a GIF message's fallback text).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b0d6f2a8c419'
down_revision: str | None = 'a9c5e1f7b308'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('gif', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_table(
        'gif_favorites',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('gif_id', sa.String(length=64), nullable=False),
        sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'provider', 'gif_id'),
    )


def downgrade() -> None:
    op.drop_table('gif_favorites')
    op.drop_column('messages', 'gif')
