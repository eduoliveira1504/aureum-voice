"""account_states: deactivate and delete accounts

Revision ID: d1f7b3c5e598
Revises: c9e5a1b3d486
Create Date: 2026-11-12 18:00:00.000000

Block 4.2.2: users.deactivated_at, users.deletion_due_at and users.delete_messages (the account
states, app/account_deletion.py); a "delete_account" e-mail code; and released_usernames, which
holds the @ of deleted accounts for a while (an HMAC only). Every existing account stays active.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'd1f7b3c5e598'
down_revision: str | None = 'c9e5a1b3d486'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_PURPOSES = "'verify', 'reset', 'change_email'"
NEW_PURPOSES = f"{OLD_PURPOSES}, 'delete_account'"


def upgrade() -> None:
    op.add_column('users', sa.Column('deactivated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('deletion_due_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('delete_messages', sa.Boolean(), server_default='false', nullable=False))
    op.create_index(op.f('ix_users_deletion_due_at'), 'users', ['deletion_due_at'])

    op.drop_constraint(op.f('ck_email_codes_email_code_purpose'), 'email_codes', type_='check')
    op.create_check_constraint(op.f('ck_email_codes_email_code_purpose'), 'email_codes', f"purpose IN ({NEW_PURPOSES})")

    op.create_table(
        'released_usernames',
        sa.Column('username_hash', sa.String(length=64), nullable=False),
        sa.Column('held_until', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('username_hash', name=op.f('pk_released_usernames')),
    )
    op.create_index(op.f('ix_released_usernames_held_until'), 'released_usernames', ['held_until'])


def downgrade() -> None:
    op.drop_index(op.f('ix_released_usernames_held_until'), table_name='released_usernames')
    op.drop_table('released_usernames')

    op.execute("DELETE FROM email_codes WHERE purpose = 'delete_account'")
    op.drop_constraint(op.f('ck_email_codes_email_code_purpose'), 'email_codes', type_='check')
    op.create_check_constraint(op.f('ck_email_codes_email_code_purpose'), 'email_codes', f"purpose IN ({OLD_PURPOSES})")

    op.drop_index(op.f('ix_users_deletion_due_at'), table_name='users')
    op.drop_column('users', 'delete_messages')
    op.drop_column('users', 'deletion_due_at')
    op.drop_column('users', 'deactivated_at')
