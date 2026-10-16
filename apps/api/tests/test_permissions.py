"""The permission calculation and the hierarchy, on plain data (no database)."""

import uuid

from app.models import OverrideTarget
from app.permissions import ALL, DEFAULT_EVERYONE, Context, Overwrite, Perm, RoleInfo, outranks

SERVER = uuid.uuid4()
OWNER, ALICE, BOB = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
MOD, VIP, ADMIN = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def context(everyone: Perm = DEFAULT_EVERYONE) -> Context:
    roles = {
        SERVER: RoleInfo(SERVER, 0, int(everyone)),
        VIP: RoleInfo(VIP, 1, int(Perm.CREATE_INVITE)),
        MOD: RoleInfo(MOD, 2, int(Perm.KICK_MEMBERS | Perm.MANAGE_MESSAGES)),
        ADMIN: RoleInfo(ADMIN, 3, int(Perm.ADMINISTRATOR)),
    }
    return Context(SERVER, OWNER, roles, {ALICE: {MOD, VIP}, BOB: set()})


def role(target: uuid.UUID, allow: Perm = Perm(0), deny: Perm = Perm(0)) -> Overwrite:
    return Overwrite(OverrideTarget.role, target, int(allow), int(deny))


def member(target: uuid.UUID, allow: Perm = Perm(0), deny: Perm = Perm(0)) -> Overwrite:
    return Overwrite(OverrideTarget.member, target, int(allow), int(deny))


def test_base_is_everyone_plus_every_role() -> None:
    ctx = context()
    assert ctx.base(BOB) == DEFAULT_EVERYONE
    assert ctx.base(ALICE) == DEFAULT_EVERYONE | Perm.CREATE_INVITE | Perm.KICK_MEMBERS | Perm.MANAGE_MESSAGES
    assert not ctx.base(ALICE) & Perm.BAN_MEMBERS


def test_owner_has_everything_even_when_denied() -> None:
    ctx = context(everyone=Perm(0))
    assert ctx.base(OWNER) == ALL
    assert ctx.in_channel(OWNER, [role(SERVER, deny=Perm.VIEW_CHANNEL), member(OWNER, deny=ALL)], voice=False) == ALL


def test_administrator_grants_everything_and_skips_overrides() -> None:
    ctx = context()
    ctx.member_roles[BOB] = {ADMIN}
    assert ctx.base(BOB) == ALL
    assert ctx.in_channel(BOB, [role(SERVER, deny=Perm.VIEW_CHANNEL), member(BOB, deny=Perm.VIEW_CHANNEL)], voice=False) == ALL


def test_everyone_override_then_roles_then_member() -> None:
    ctx = context()
    private = [role(SERVER, deny=Perm.VIEW_CHANNEL), role(MOD, allow=Perm.VIEW_CHANNEL)]
    assert ctx.in_channel(BOB, private, voice=False) == 0  # hidden for @everyone
    assert ctx.in_channel(ALICE, private, voice=False) & Perm.VIEW_CHANNEL  # a role lets her back in

    # A member override beats the roles.
    assert ctx.in_channel(ALICE, [*private, member(ALICE, deny=Perm.VIEW_CHANNEL)], voice=False) == 0
    assert ctx.in_channel(BOB, [*private, member(BOB, allow=Perm.VIEW_CHANNEL)], voice=False) & Perm.VIEW_CHANNEL


def test_between_roles_allow_wins() -> None:
    ctx = context()
    overwrites = [role(VIP, deny=Perm.SEND_MESSAGES), role(MOD, allow=Perm.SEND_MESSAGES)]
    assert ctx.in_channel(ALICE, overwrites, voice=False) & Perm.SEND_MESSAGES
    # Role denies still win over @everyone's allow.
    overwrites = [role(SERVER, allow=Perm.SEND_MESSAGES), role(VIP, deny=Perm.SEND_MESSAGES)]
    assert not ctx.in_channel(ALICE, overwrites, voice=False) & Perm.SEND_MESSAGES


def test_overrides_only_touch_their_bits() -> None:
    ctx = context()
    perms = ctx.in_channel(BOB, [role(SERVER, deny=Perm.SEND_MESSAGES)], voice=False)
    assert perms == DEFAULT_EVERYONE & ~Perm.SEND_MESSAGES


def test_without_view_nothing_and_without_connect_no_voice() -> None:
    ctx = context()
    assert ctx.in_channel(BOB, [member(BOB, deny=Perm.VIEW_CHANNEL)], voice=True) == 0
    perms = ctx.in_channel(BOB, [role(SERVER, deny=Perm.CONNECT)], voice=True)
    assert perms & Perm.VIEW_CHANNEL
    assert not perms & (Perm.SPEAK | Perm.VIDEO | Perm.STREAM)
    # CONNECT doesn't matter in text channels.
    assert ctx.in_channel(BOB, [role(SERVER, deny=Perm.CONNECT)], voice=False) & Perm.SPEAK


def test_hierarchy() -> None:
    ctx = context()
    assert ctx.rank(OWNER) > ctx.rank(ALICE) == 2
    assert ctx.rank(BOB) == 0
    # Alice manages what's strictly below her highest role.
    assert outranks(ctx, ALICE, ctx.roles[VIP].position)
    assert not outranks(ctx, ALICE, ctx.roles[MOD].position)
    assert not outranks(ctx, ALICE, ctx.roles[ADMIN].position)
    assert outranks(ctx, ALICE, ctx.rank(BOB))
    assert not outranks(ctx, BOB, ctx.rank(ALICE))
    # The owner is above everything, and nobody is above the owner.
    assert outranks(ctx, OWNER, ctx.roles[ADMIN].position)
    assert not outranks(ctx, ALICE, ctx.rank(OWNER))
