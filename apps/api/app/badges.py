"""Badges ("insígnias"): the catalog lives here and is copied into the badges table when the API
starts (sync_badges), so adding one is a new entry in BADGES. Grants keep the badge's id, so
renaming a badge or swapping its art never touches who holds it or their numbers.

Who gets what:
- founder: the account named in AUREUM_OWNER_USERNAME (at sign-up, or at startup if it exists).
- pioneer (numbered by sign-up order): accounts created through sign-up while AUREUM_BETA=true.
- bug_hunter: the author of a bug report the owner marks as resolved.
Mythic badges are beta-only (exclusive_beta): once AUREUM_BETA is off they're never granted again.

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
from app.models import Badge, BadgeRarity, User, UserBadge
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
            icon_svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,4 86,26 86,70 48,92 10,70 10,26" fill="none" stroke="#E8B531" stroke-width="2"/><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#2A1F08" stroke="#E8B531" stroke-width="3" stroke-linejoin="round"/><path d="M28 62 L24 36 L37 46 L48 30 L59 46 L72 36 L68 62 Z" fill="#E8B531" stroke="#E8B531" stroke-width="2" stroke-linejoin="round"/><path d="M30 68 H66" stroke="#F4CF6A" stroke-width="3.5" stroke-linecap="round"/></svg>',
            icon_svg_small='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#2A1F08" stroke="#E8B531" stroke-width="6" stroke-linejoin="round"/><path d="M28 64 L24 36 L37 46 L48 30 L59 46 L72 36 L68 64 Z" fill="#E8B531"/></svg>',
        ),
        BadgeDefinition(
            # Name and art are placeholders while the testers vote; swapping them keeps the numbers.
            key=PIONEER,
            name="Pioneiro",
            description="Entrou no Aureum durante o beta.",
            rarity=BadgeRarity.mitica,
            numbered=True,
            exclusive_beta=True,
            icon_svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,4 86,26 86,70 48,92 10,70 10,26" fill="none" stroke="#E8B531" stroke-width="2"/><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#2A1F08" stroke="#E8B531" stroke-width="3" stroke-linejoin="round"/><path d="M48 34 L51.5 44.5 L62 48 L51.5 51.5 L48 62 L44.5 51.5 L34 48 L44.5 44.5 Z" fill="#F4CF6A" opacity="0.55" transform="rotate(45 48 48)"/><path d="M48 22 L53.5 42.5 L74 48 L53.5 53.5 L48 74 L42.5 53.5 L22 48 L42.5 42.5 Z" fill="#E8B531"/><circle cx="48" cy="48" r="4" fill="#2A1F08"/></svg>',
            icon_svg_small='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#2A1F08" stroke="#E8B531" stroke-width="6" stroke-linejoin="round"/><path d="M48 20 L54 42 L76 48 L54 54 L48 76 L42 54 L20 48 L42 42 Z" fill="#E8B531"/></svg>',
        ),
        BadgeDefinition(
            key=BUG_HUNTER,
            name="Caçador de bugs",
            description="Reportou um problema que foi resolvido.",
            rarity=BadgeRarity.rara,
            icon_svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#1C2228" stroke="#C9D1DA" stroke-width="3" stroke-linejoin="round"/><ellipse cx="48" cy="52" rx="12" ry="15" fill="#C9D1DA"/><circle cx="48" cy="35" r="7" fill="#C9D1DA"/><path d="M48 40 V67" stroke="#1C2228" stroke-width="2"/><g stroke="#C9D1DA" stroke-width="2.6" stroke-linecap="round"><path d="M36 46 L27 42"/><path d="M36 54 L26 54"/><path d="M37 62 L28 67"/><path d="M60 46 L69 42"/><path d="M60 54 L70 54"/><path d="M59 62 L68 67"/><path d="M44 29 L40 23"/><path d="M52 29 L56 23"/></g></svg>',
            icon_svg_small='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29" fill="#1C2228" stroke="#C9D1DA" stroke-width="6" stroke-linejoin="round"/><ellipse cx="48" cy="52" rx="13" ry="16" fill="#C9D1DA"/><circle cx="48" cy="33" r="8" fill="#C9D1DA"/></svg>',
        ),
    )
}

# Serializes the numbering of numbered badges (two sign-ups at once never get the same number).
_NUMBER_LOCK = 0x41_55_52_42  # "AURB"


class BadgeClosed(Exception):
    """A beta-only badge asked for after the beta."""


async def sync_badges(session: AsyncSession) -> None:
    """Creates or updates the badges table from BADGES. Badges removed from the code stay in
    the table (and with whoever holds them)."""
    rows = {b.key: b for b in await session.scalars(select(Badge))}
    for definition in BADGES.values():
        row = rows.get(definition.key) or Badge(key=definition.key)
        for field in ("name", "description", "rarity", "icon_svg", "icon_svg_small", "numbered", "exclusive_beta"):
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
    if badge.numbered:
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
    """Founder for the owner's account; the numbered beta badge while the beta runs."""
    settings = get_settings()
    if not settings.aureum_beta:
        return  # both are beta-only
    if user.username == settings.owner_username:
        await grant(session, user, FOUNDER)
    await grant(session, user, PIONEER)


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
