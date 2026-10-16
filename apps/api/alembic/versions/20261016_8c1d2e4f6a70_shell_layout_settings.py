"""shell layout settings

Revision ID: 8c1d2e4f6a70
Revises: 2473c4911ac9
Create Date: 2026-10-16 18:10:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '8c1d2e4f6a70'
down_revision: str | None = '2473c4911ac9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('tab_order', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    op.add_column('user_settings', sa.Column('closed_tabs', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    op.add_column('user_settings', sa.Column('sidebar_collapsed', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('user_settings', sa.Column('panel_layouts', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))


def downgrade() -> None:
    op.drop_column('user_settings', 'panel_layouts')
    op.drop_column('user_settings', 'sidebar_collapsed')
    op.drop_column('user_settings', 'closed_tabs')
    op.drop_column('user_settings', 'tab_order')
