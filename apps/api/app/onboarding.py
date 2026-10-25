"""What happens when an account confirms its e-mail (the code from sign-up, or the CLI's
--confirmado). All in the caller's transaction:

- the invite it signed up with counts one use (even if it ran out meanwhile);
- the beta badges, while AUREUM_BETA=true: Pioneiro (numbered, while numbers last) and Beta Tester;
- 3 single-use account invites;
- it joins every official server it isn't banned from;
- the welcome e-mail, with its Pioneiro number and invites.

Official accounts (--oficial) get none of the badge, invites or welcome; that exception comes
only from the flag, never from how the account was made."""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import account_invites, badges, bot, codes, mail
from app.config import get_settings
from app.models import AccountInvite, AccountInviteUse, EmailCodePurpose, Server, ServerBan, ServerMember, User


@dataclass
class Confirmed:
    pioneer_number: int | None = None
    # Badges handed out just now (not on an earlier confirmation), e.g. Pioneiro and Beta Tester.
    granted: list[str] = field(default_factory=list)
    invites: int = 0
    joined: list[ServerMember] = field(default_factory=list)
    # Whose invite the account signed up with, if it was someone's (not a CLI invite).
    inviter_id: uuid.UUID | None = None


async def send_verification(session: AsyncSession, user: User, *, wait: bool = True) -> None:
    """Queues a confirmation code to the account's address (raises codes.TooSoon with wait)."""
    code = await codes.issue(session, user.id, EmailCodePurpose.verify, wait=wait)
    mail.enqueue(session, user.email, "code_verify", codigo=code, nome=user.display_name)


async def _join_official_servers(session: AsyncSession, user_id: uuid.UUID) -> list[ServerMember]:
    joined = []
    for server_id in await session.scalars(select(Server.id).where(Server.is_official)):
        if await session.get(ServerMember, (server_id, user_id)) or await session.get(ServerBan, (server_id, user_id)):
            continue
        member = ServerMember(server_id=server_id, user_id=user_id)
        session.add(member)
        joined.append(member)
    return joined


async def confirm(session: AsyncSession, user: User) -> Confirmed:
    """Marks the e-mail confirmed and hands out what that brings (not committed). Afterwards,
    call announce() with the result."""
    now = datetime.now(UTC)
    user.email_verified_at = now
    result = Confirmed()

    use = await session.get(AccountInviteUse, user.id)
    if use is not None and use.confirmed_at is None:
        use.confirmed_at = now
        await session.execute(update(AccountInvite).where(AccountInvite.code == use.code).values(uses=AccountInvite.uses + 1))
        result.inviter_id = await session.scalar(select(AccountInvite.owner_id).where(AccountInvite.code == use.code))

    if not user.is_official:
        if get_settings().aureum_beta:
            held = await badges.grant(session, user, badges.PIONEER)
            if held is not None:
                result.granted.append(badges.PIONEER)
            result.pioneer_number = held.number if held else next(
                (g.number for g in user.badge_grants if g.badge.key == badges.PIONEER), None
            )
            if await badges.grant(session, user, badges.BETA_TESTER) is not None:
                result.granted.append(badges.BETA_TESTER)
        for _ in range(account_invites.PER_USER):
            account_invites.create(session, owner_id=user.id)
        result.invites = account_invites.PER_USER

    result.joined = await _join_official_servers(session, user.id)

    if not user.is_official:
        mail.enqueue(
            session, user.email, "welcome",
            nome=user.display_name, numero=result.pioneer_number, convites=result.invites,
            servidor=bool(result.joined),
        )
    return result


async def announce(session: AsyncSession, user: User, result: Confirmed) -> None:
    """After the commit: the new member shows up in the servers (welcomed by the bot), the
    badge on the profile, and the official DM tells the newcomer about the badge and whoever
    invited them that they arrived."""
    from app.routers.servers import announce_member_joined  # the router imports this module

    for member in result.joined:
        await announce_member_joined(session, member)
    if result.granted:
        await badges.announce(session, user)
    for key in result.granted:
        await bot.badge_granted(user.id, key)
    if result.inviter_id is not None:
        await bot.invite_used(result.inviter_id, user.id)
