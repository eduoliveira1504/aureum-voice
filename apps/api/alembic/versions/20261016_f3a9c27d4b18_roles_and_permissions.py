"""roles and permissions

Replaces server_members.role (owner|admin|member) with real roles: every server gets its
@everyone role (id = server id), and servers with admins get an "Admin" role with
ADMINISTRATOR given to them. The owner is servers.owner_id, as before.

Revision ID: f3a9c27d4b18
Revises: c5e32e2487e5
Create Date: 2026-10-16 18:20:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'f3a9c27d4b18'
down_revision: str | None = 'c5e32e2487e5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copies of app.permissions values, so this migration never changes meaning.
ADMINISTRATOR = 1 << 0
DEFAULT_EVERYONE = sum(1 << b for b in (7, 9, 10, 11, 12, 15, 16, 17, 18, 19))


def upgrade() -> None:
    op.add_column('servers', sa.Column('banner_url', sa.String(length=512), nullable=True))
    op.add_column('user_settings', sa.Column('members_open', sa.Boolean(), server_default='false', nullable=False))

    op.create_table('roles',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('server_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('color', sa.String(length=7), nullable=True),
    sa.Column('icon_url', sa.String(length=512), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('permissions', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('hoist', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('mentionable', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['server_id'], ['servers.id'], name=op.f('fk_roles_server_id_servers'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_roles'))
    )
    op.create_index(op.f('ix_roles_server_id'), 'roles', ['server_id'], unique=False)

    op.create_table('member_roles',
    sa.Column('server_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('role_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], name=op.f('fk_member_roles_role_id_roles'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['server_id', 'user_id'], ['server_members.server_id', 'server_members.user_id'], name='fk_member_roles_member_server_members', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('server_id', 'user_id', 'role_id', name=op.f('pk_member_roles'))
    )
    op.create_index(op.f('ix_member_roles_role_id'), 'member_roles', ['role_id'], unique=False)

    op.create_table('server_bans',
    sa.Column('server_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('banned_by', sa.UUID(), nullable=True),
    sa.Column('reason', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['banned_by'], ['users.id'], name=op.f('fk_server_bans_banned_by_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['server_id'], ['servers.id'], name=op.f('fk_server_bans_server_id_servers'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_server_bans_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('server_id', 'user_id', name=op.f('pk_server_bans'))
    )
    op.create_index(op.f('ix_server_bans_user_id'), 'server_bans', ['user_id'], unique=False)

    op.create_table('channel_permission_overrides',
    sa.Column('channel_id', sa.UUID(), nullable=False),
    sa.Column('target_type', sa.Enum('role', 'member', name='override_target', native_enum=False, create_constraint=True, length=16), nullable=False),
    sa.Column('target_id', sa.UUID(), nullable=False),
    sa.Column('allow', sa.BigInteger(), server_default='0', nullable=False),
    sa.Column('deny', sa.BigInteger(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['channel_id'], ['channels.id'], name=op.f('fk_channel_permission_overrides_channel_id_channels'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('channel_id', 'target_type', 'target_id', name=op.f('pk_channel_permission_overrides'))
    )
    op.create_index(op.f('ix_channel_permission_overrides_target_id'), 'channel_permission_overrides', ['target_id'], unique=False)

    # @everyone for every existing server.
    op.execute(
        f"INSERT INTO roles (id, server_id, name, position, permissions) "
        f"SELECT id, id, '@everyone', 0, {DEFAULT_EVERYONE} FROM servers"
    )
    # Admins become an "Admin" role with ADMINISTRATOR.
    op.execute(
        f"INSERT INTO roles (id, server_id, name, position, permissions, hoist) "
        f"SELECT gen_random_uuid(), server_id, 'Admin', 1, {ADMINISTRATOR}, true "
        f"FROM server_members WHERE role = 'admin' GROUP BY server_id"
    )
    op.execute(
        "INSERT INTO member_roles (server_id, user_id, role_id) "
        "SELECT m.server_id, m.user_id, r.id FROM server_members m "
        "JOIN roles r ON r.server_id = m.server_id AND r.name = 'Admin' AND r.position = 1 "
        "WHERE m.role = 'admin'"
    )
    op.drop_column('server_members', 'role')


def downgrade() -> None:
    op.add_column('server_members', sa.Column('role', sa.Enum('owner', 'admin', 'member', name='member_role', native_enum=False, create_constraint=True, length=16), server_default='member', nullable=False))
    op.execute(
        "UPDATE server_members m SET role = 'owner' FROM servers s WHERE s.id = m.server_id AND s.owner_id = m.user_id"
    )
    op.execute(
        f"UPDATE server_members m SET role = 'admin' WHERE role = 'member' AND EXISTS ("
        f"SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id "
        f"WHERE mr.server_id = m.server_id AND mr.user_id = m.user_id AND r.permissions & {ADMINISTRATOR} <> 0)"
    )
    op.alter_column('server_members', 'role', server_default=None)
    op.drop_index(op.f('ix_channel_permission_overrides_target_id'), table_name='channel_permission_overrides')
    op.drop_table('channel_permission_overrides')
    op.drop_index(op.f('ix_server_bans_user_id'), table_name='server_bans')
    op.drop_table('server_bans')
    op.drop_index(op.f('ix_member_roles_role_id'), table_name='member_roles')
    op.drop_table('member_roles')
    op.drop_index(op.f('ix_roles_server_id'), table_name='roles')
    op.drop_table('roles')
    op.drop_column('user_settings', 'members_open')
    op.drop_column('servers', 'banner_url')
