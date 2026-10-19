"""voice messages

Revision ID: f5a1c3e8d260
Revises: e8c2a4f7b915
Create Date: 2026-10-20 15:00:00.000000

Voice messages are attachments of kind 'voice' (Opus/WebM), with their duration and waveform
in attachments.meta so the player draws them without decoding the file.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'f5a1c3e8d260'
down_revision: str | None = 'e8c2a4f7b915'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f('ck_attachments_attachment_kind'), 'attachments', type_='check')
    op.create_check_constraint(op.f('ck_attachments_attachment_kind'), 'attachments', "kind IN ('image', 'video', 'file', 'voice')")
    op.add_column('attachments', sa.Column('meta', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('attachments', 'meta')
    op.execute("UPDATE attachments SET kind = 'file' WHERE kind = 'voice'")
    op.drop_constraint(op.f('ck_attachments_attachment_kind'), 'attachments', type_='check')
    op.create_check_constraint(op.f('ck_attachments_attachment_kind'), 'attachments', "kind IN ('image', 'video', 'file')")
