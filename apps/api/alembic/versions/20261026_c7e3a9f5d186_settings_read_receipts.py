"""user_settings: read_receipts

Revision ID: c7e3a9f5d186
Revises: b6d2f8a4c975
Create Date: 2026-10-26 18:00:00.000000

Block 3.11 (part B): "Confirmação de leitura" in Configurações › Privacidade, on by default. A
column with a default: the app's previous version keeps working.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c7e3a9f5d186'
down_revision: str | None = 'b6d2f8a4c975'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('read_receipts', sa.Boolean(), server_default='true', nullable=False))


def downgrade() -> None:
    op.drop_column('user_settings', 'read_receipts')
