"""users/servers: kept originals of cropped images

Revision ID: c6e1a9d4f357
Revises: b8d4f2a6c731
Create Date: 2026-10-25 20:00:00.000000

Block 3.10: avatars, profile banners and server icons/banners picked in the app's crop editor
are cropped by the API, which keeps the original ({"key", "crop"}) so they can be re-cropped.
Null for images uploaded without a crop (and for every image before this).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'c6e1a9d4f357'
down_revision: str | None = 'b8d4f2a6c731'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (('users', 'avatar_source'), ('users', 'banner_source'), ('servers', 'icon_source'), ('servers', 'banner_source'))


def upgrade() -> None:
    for table, column in COLUMNS:
        op.add_column(table, sa.Column(column, postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    for table, column in COLUMNS:
        op.drop_column(table, column)
