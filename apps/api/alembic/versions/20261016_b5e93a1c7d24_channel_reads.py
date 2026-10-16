"""channel reads

Revision ID: b5e93a1c7d24
Revises: 8c1d2e4f6a70
Create Date: 2026-10-16 18:12:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'b5e93a1c7d24'
down_revision: str | None = '8c1d2e4f6a70'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('channel_reads',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('channel_id', sa.UUID(), nullable=False),
    sa.Column('last_read_message_id', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('mention_count', sa.Integer(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], name=op.f('fk_channel_reads_channel_id_channels'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_channel_reads_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'channel_id', name=op.f('pk_channel_reads'))
    )
    op.create_index(op.f('ix_channel_reads_channel_id'), 'channel_reads', ['channel_id'], unique=False)
    # Existing members start with everything already read, not the whole history unread.
    op.execute("""
        INSERT INTO channel_reads (user_id, channel_id, last_read_message_id, mention_count)
        SELECT sm.user_id, c.id, COALESCE(MAX(m.id), 0), 0
        FROM server_members sm
        JOIN channels c ON c.server_id = sm.server_id AND c.type = 'text'
        LEFT JOIN messages m ON m.channel_id = c.id
        GROUP BY sm.user_id, c.id
    """)


def downgrade() -> None:
    op.drop_index(op.f('ix_channel_reads_channel_id'), table_name='channel_reads')
    op.drop_table('channel_reads')
