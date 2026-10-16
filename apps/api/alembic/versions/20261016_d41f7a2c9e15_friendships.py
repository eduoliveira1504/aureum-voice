"""friendships

Revision ID: d41f7a2c9e15
Revises: b5e93a1c7d24
Create Date: 2026-10-16 20:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'd41f7a2c9e15'
down_revision: str | None = 'b5e93a1c7d24'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('friendships',
    sa.Column('requester_id', sa.UUID(), nullable=False),
    sa.Column('addressee_id', sa.UUID(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'accepted', 'blocked', name='friendship_status', native_enum=False, create_constraint=True, length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['addressee_id'], ['users.id'], name=op.f('fk_friendships_addressee_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['requester_id'], ['users.id'], name=op.f('fk_friendships_requester_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('requester_id', 'addressee_id', name=op.f('pk_friendships'))
    )
    op.create_index(op.f('ix_friendships_addressee_id'), 'friendships', ['addressee_id'], unique=False)
    op.create_index(
        'uq_friendships_pair', 'friendships',
        [sa.text('least(requester_id, addressee_id)'), sa.text('greatest(requester_id, addressee_id)')],
        unique=True, postgresql_where=sa.text("status <> 'blocked'"),
    )


def downgrade() -> None:
    op.drop_index('uq_friendships_pair', table_name='friendships', postgresql_where=sa.text("status <> 'blocked'"))
    op.drop_index(op.f('ix_friendships_addressee_id'), table_name='friendships')
    op.drop_table('friendships')
