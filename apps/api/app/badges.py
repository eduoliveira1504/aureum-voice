"""Badges ("insígnias"): the catalog lives here and is copied into the badges table when the API
starts (sync_badges), so adding one is a new entry in BADGES. Grants keep the badge's id, so
renaming a badge or swapping its art never touches who holds it or their numbers.

Who gets what:
- founder: the account named in AUREUM_OWNER_USERNAME (at sign-up, or at startup if it exists).
- pioneer (numbered): accounts that confirm their e-mail while AUREUM_BETA=true, except official
  ones (app/onboarding.py). Numbers come from a Postgres sequence and a ledger (PioneerNumber):
  unique, never reused, and some can be reserved ahead (CLI --pioneiro N).
- bug_hunter: the author of a bug report the owner marks as resolved.
Mythic badges are beta-only (exclusive_beta): once AUREUM_BETA is off they're never granted again.
Next to a name the app shows the two rarest; `priority` breaks ties (Fundador before Pioneiro).

Planned (structure ready, added here once their art exists): Veterano (rara, per year of
account), Construtor (comum, a server with 5+ members), Aureum+ (lendaria, future plan).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import audience_ids
from app.config import get_settings
from app.models import AccountInviteUse, Badge, BadgeRarity, PioneerNumber, User, UserBadge
from app.realtime import broker


@dataclass(frozen=True)
class BadgeDefinition:
    key: str
    name: str
    description: str
    rarity: BadgeRarity
    icon_svg: str
    icon_svg_small: str
    numbered: bool = False
    exclusive_beta: bool = False
    # Ties within a rarity next to a name: lower first (then the oldest grant).
    priority: int = 100


FOUNDER = "founder"
PIONEER = "pioneer"
BUG_HUNTER = "bug_hunter"

BADGES: dict[str, BadgeDefinition] = {
    b.key: b
    for b in (
        BadgeDefinition(
            key=FOUNDER,
            name="Fundador",
            description="Criou o Aureum.",
            rarity=BadgeRarity.mitica,
            exclusive_beta=True,
            priority=0,
            icon_svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,4 86,26 86,70 48,92 10,70 10,26" fill="none" stroke="#E8B531" stroke-width="2"/><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#2A1F08" stroke="#E8B531" stroke-width="3" stroke-linejoin="round"/><path d="M48 26 L66 70 H56 L48 50 L40 70 H30 Z" fill="#E8B531" stroke="#E8B531" stroke-width="1.5" stroke-linejoin="round"/></svg>',
            icon_svg_small='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#2A1F08" stroke="#E8B531" stroke-width="6" stroke-linejoin="round"/><path d="M48 22 L69 70 H57 L48 48 L39 70 H27 Z" fill="#E8B531"/></svg>',
        ),
        BadgeDefinition(
            # Name and art are placeholders while the testers vote; swapping them keeps the numbers.
            key=PIONEER,
            name="Pioneiro",
            description="Entrou no Aureum durante o beta.",
            rarity=BadgeRarity.mitica,
            numbered=True,
            exclusive_beta=True,
            priority=1,
            icon_svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,4 86,26 86,70 48,92 10,70 10,26" fill="none" stroke="#E8B531" stroke-width="2"/><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#2A1F08" stroke="#E8B531" stroke-width="3" stroke-linejoin="round"/><path d="M48 34 L51.5 44.5 L62 48 L51.5 51.5 L48 62 L44.5 51.5 L34 48 L44.5 44.5 Z" fill="#F4CF6A" opacity="0.55" transform="rotate(45 48 48)"/><path d="M48 22 L53.5 42.5 L74 48 L53.5 53.5 L48 74 L42.5 53.5 L22 48 L42.5 42.5 Z" fill="#E8B531"/><circle cx="48" cy="48" r="4" fill="#2A1F08"/></svg>',
            icon_svg_small='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#2A1F08" stroke="#E8B531" stroke-width="6" stroke-linejoin="round"/><path d="M48 20 L54 42 L76 48 L54 54 L48 76 L42 54 L20 48 L42 42 Z" fill="#E8B531"/></svg>',
        ),
        BadgeDefinition(
            key=BUG_HUNTER,
            name="Caçador de bugs",
            description="Reportou um problema que foi resolvido.",
            rarity=BadgeRarity.rara,
            priority=2,
            icon_svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#1C2228" stroke="#C9D1DA" stroke-width="3" stroke-linejoin="round"/><ellipse cx="48" cy="52" rx="12" ry="15" fill="#C9D1DA"/><circle cx="48" cy="35" r="7" fill="#C9D1DA"/><path d="M48 40 V67" stroke="#1C2228" stroke-width="2"/><g stroke="#C9D1DA" stroke-width="2.6" stroke-linecap="round"><path d="M36 46 L27 42"/><path d="M36 54 L26 54"/><path d="M37 62 L28 67"/><path d="M60 46 L69 42"/><path d="M60 54 L70 54"/><path d="M59 62 L68 67"/><path d="M44 29 L40 23"/><path d="M52 29 L56 23"/></g></svg>',
            icon_svg_small='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#1C2228" stroke="#C9D1DA" stroke-width="6" stroke-linejoin="round"/><ellipse cx="48" cy="52" rx="13" ry="16" fill="#C9D1DA"/><circle cx="48" cy="33" r="8" fill="#C9D1DA"/></svg>',
        ),
    )
}

# Serializes the numbering of other numbered badges (the Pioneiro one uses its sequence).
_NUMBER_LOCK = 0x41_55_52_42  # "AURB"


class BadgeClosed(Exception):
    """A beta-only badge asked for after the beta."""


class NumberTaken(Exception):
    """A Pioneiro number that is already reserved or was handed out (maybe to a deleted account)."""


async def reserve_pioneer_number(
    session: AsyncSession, number: int, *, user_id: uuid.UUID | None = None, invite_code: str | None = None
) -> None:
    """Keeps `number` for that user or for whoever signs up with that invite (not committed)."""
    inserted = await session.scalar(
        text(
            "INSERT INTO pioneer_numbers (number, user_id, invite_code) VALUES (:n, :u, :c) "
            "ON CONFLICT DO NOTHING RETURNING number"
        ),
        {"n": number, "u": user_id, "c": invite_code},
    )
    if inserted is None:
        raise NumberTaken(number)


async def _pioneer_number(session: AsyncSession, user: User) -> int:
    """The number reserved for the user (directly or through their invite), else the next free
    one from the sequence. nextval never hands out a value twice, even across transactions that
    roll back, and the ledger insert skips numbers someone reserved ahead."""
    mine = await session.scalar(select(PioneerNumber.number).where(PioneerNumber.user_id == user.id))
    if mine is not None:
        return mine
    use = await session.get(AccountInviteUse, user.id)
    if use is not None:
        claimed = await session.scalar(
            text(
                "UPDATE pioneer_numbers SET user_id = :u WHERE invite_code = :c AND user_id IS NULL RETURNING number"
            ),
            {"u": user.id, "c": use.code},
        )
        if claimed is not None:
            return claimed
    while True:
        number = await session.scalar(text("SELECT nextval('pioneer_number_seq')"))
        taken = await session.scalar(
            text("INSERT INTO pioneer_numbers (number, user_id) VALUES (:n, :u) ON CONFLICT DO NOTHING RETURNING number"),
            {"n": number, "u": user.id},
        )
        if taken is not None:
            return number


async def sync_badges(session: AsyncSession) -> None:
    """Creates or updates the badges table from BADGES. Badges removed from the code stay in
    the table (and with whoever holds them)."""
    rows = {b.key: b for b in await session.scalars(select(Badge))}
    for definition in BADGES.values():
        row = rows.get(definition.key) or Badge(key=definition.key)
        for field in ("name", "description", "rarity", "icon_svg", "icon_svg_small", "numbered", "exclusive_beta", "priority"):
            setattr(row, field, getattr(definition, field))
        session.add(row)
    await session.commit()


async def grant(session: AsyncSession, user: User, key: str, granted_by: uuid.UUID | None = None) -> UserBadge | None:
    """Gives `user` the badge (not committed). None if they already hold it; raises BadgeClosed
    for a beta-only badge once the beta is over, and KeyError for an unknown badge."""
    badge = await session.scalar(select(Badge).where(Badge.key == key))
    if badge is None:
        raise KeyError(key)
    if any(g.badge_id == badge.id for g in user.badge_grants):
        return None
    if badge.exclusive_beta and not get_settings().aureum_beta:
        raise BadgeClosed(key)
    number = None
    if key == PIONEER:
        await session.flush()  # the user row must exist for the ledger
        number = await _pioneer_number(session, user)
    elif badge.numbered:
        await session.execute(text("SELECT pg_advisory_xact_lock(:lock)"), {"lock": _NUMBER_LOCK})
        last = await session.scalar(select(func.max(UserBadge.number)).where(UserBadge.badge_id == badge.id))
        number = (last or 0) + 1
    held = UserBadge(badge=badge, number=number, granted_at=datetime.now(UTC), granted_by=granted_by)
    user.badge_grants.append(held)
    return held


async def revoke(session: AsyncSession, user: User, key: str) -> bool:
    held = next((g for g in user.badge_grants if g.badge.key == key), None)
    if held is None:
        return False
    user.badge_grants.remove(held)
    return True


async def grant_at_sign_up(session: AsyncSession, user: User) -> None:
    """Founder for the owner's account while the beta runs. (The beta badge comes later, when the
    e-mail is confirmed: see app/onboarding.py.)"""
    settings = get_settings()
    if settings.aureum_beta and user.username == settings.owner_username:
        await grant(session, user, FOUNDER)


async def grant_founder_if_due(session: AsyncSession) -> None:
    """At startup: the owner's account gets Founder if it exists already and lacks it."""
    settings = get_settings()
    if not settings.owner_username or not settings.aureum_beta:
        return
    owner = await session.scalar(select(User).where(User.username == settings.owner_username))
    if owner is not None and await grant(session, owner, FOUNDER):
        await session.commit()
        await announce(session, owner)


async def announce(session: AsyncSession, user: User) -> None:
    """Profiles update live for everyone who sees the user."""
    from app.schemas import UserPublic  # schemas imports models; keep this module light

    data = UserPublic.model_validate(user).model_dump(mode="json")
    await broker.publish("user.updated", data, await audience_ids(session, user.id))
