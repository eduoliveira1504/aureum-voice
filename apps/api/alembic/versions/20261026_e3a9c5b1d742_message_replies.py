"""messages: reply_to_id

Revision ID: e3a9c5b1d742
Revises: d7f2b4e8a913
Create Date: 2026-10-26 10:00:00.000000

Block 3.11 (part A): a message can answer another of the same channel. No foreign key on purpose:
when the original is deleted the reply keeps its id, and the app shows "Mensagem original apagada".
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'e3a9c5b1d742'
down_revision: str | None = 'd7f2b4e8a913'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('reply_to_id', sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'reply_to_id')
