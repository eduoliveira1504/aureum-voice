"""accounts, invites and e-mail

Revision ID: a7d2e9c4b113
Revises: f5a1c3e8d260
Create Date: 2026-10-21 12:45:24.139616

Block 2.10: e-mail confirmation codes, account invites (separate from server invites), the
beta badge's number ledger and sequence, the outgoing e-mail queue, official accounts and
servers, and a session epoch that ends every session when the password changes.
Existing accounts start unconfirmed (they see the notice in the app).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a7d2e9c4b113'
down_revision: str | None = 'f5a1c3e8d260'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('email_outbox',
    sa.Column('id', sa.BigInteger(), sa.Identity(always=False), nullable=False),
    sa.Column('to_address', sa.String(length=320), nullable=False),
    sa.Column('template', sa.String(length=32), nullable=False),
    sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('failed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_error', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_outbox'))
    )
    op.create_index('ix_email_outbox_due', 'email_outbox', ['next_attempt_at'], unique=False, postgresql_where=sa.text('failed_at IS NULL'))
    op.create_table('account_invites',
    sa.Column('code', sa.String(length=16), nullable=False),
    sa.Column('kind', sa.Enum('single', 'group', name='account_invite_kind', native_enum=False, create_constraint=True, length=16), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('max_uses', sa.Integer(), nullable=False),
    sa.Column('uses', sa.Integer(), server_default='0', nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_account_invites_owner_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('code', name=op.f('pk_account_invites'))
    )
    op.create_index(op.f('ix_account_invites_owner_id'), 'account_invites', ['owner_id'], unique=False)
    op.create_table('email_codes',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('purpose', sa.Enum('verify', 'reset', 'change_email', name='email_code_purpose', native_enum=False, create_constraint=True, length=16), nullable=False),
    sa.Column('code_hash', sa.String(length=64), nullable=False),
    sa.Column('new_email', sa.String(length=320), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_email_codes_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'purpose', name=op.f('pk_email_codes'))
    )
    op.create_table('account_invite_uses',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('code', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['code'], ['account_invites.code'], name=op.f('fk_account_invite_uses_code_account_invites'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_account_invite_uses_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_account_invite_uses'))
    )
    op.create_index(op.f('ix_account_invite_uses_code'), 'account_invite_uses', ['code'], unique=False)
    op.create_table('pioneer_numbers',
    sa.Column('number', sa.Integer(), autoincrement=False, nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('invite_code', sa.String(length=16), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['invite_code'], ['account_invites.code'], name=op.f('fk_pioneer_numbers_invite_code_account_invites'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_pioneer_numbers_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('number', name=op.f('pk_pioneer_numbers')),
    sa.UniqueConstraint('invite_code', name=op.f('uq_pioneer_numbers_invite_code')),
    sa.UniqueConstraint('user_id', name=op.f('uq_pioneer_numbers_user_id'))
    )
    op.add_column('servers', sa.Column('is_official', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('is_official', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('must_change_password', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('session_epoch', sa.Integer(), server_default='0', nullable=False))

    # Numbers already handed out go in the ledger, and the sequence continues after them.
    op.execute("CREATE SEQUENCE pioneer_number_seq START 1")
    op.execute(
        "INSERT INTO pioneer_numbers (number, user_id) "
        "SELECT ub.number, ub.user_id FROM user_badges ub JOIN badges b ON b.id = ub.badge_id "
        "WHERE b.key = 'pioneer' AND ub.number IS NOT NULL"
    )
    op.execute(
        "SELECT setval('pioneer_number_seq', max(number)) FROM pioneer_numbers HAVING max(number) IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP SEQUENCE pioneer_number_seq")
    op.drop_column('users', 'session_epoch')
    op.drop_column('users', 'must_change_password')
    op.drop_column('users', 'is_official')
    op.drop_column('users', 'email_verified_at')
    op.drop_column('servers', 'is_official')
    op.drop_table('pioneer_numbers')
    op.drop_index(op.f('ix_account_invite_uses_code'), table_name='account_invite_uses')
    op.drop_table('account_invite_uses')
    op.drop_table('email_codes')
    op.drop_index(op.f('ix_account_invites_owner_id'), table_name='account_invites')
    op.drop_table('account_invites')
    op.drop_index('ix_email_outbox_due', table_name='email_outbox', postgresql_where=sa.text('failed_at IS NULL'))
    op.drop_table('email_outbox')
