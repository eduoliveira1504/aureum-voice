"""Channel categories (block 3.12; see docs/decisions/0037-channel-categories.md).

Access is always decided by each channel's own overrides. A category's overrides are a template:
while a channel is `permissions_synced`, it holds a copy of them. So nothing that checks access
knows categories exist, and a channel is never opened by landing in a category: moving keeps its
permissions, and it counts as synced only if they already match.

Each server has one "addons" category (block 4.2.8): addons live there and only they do. It can't be
renamed or deleted, and its name is reserved. Apps show it translated.
"""

import uuid
from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CategoryKind, Channel, ChannelCategory, ChannelCategoryOverride, ChannelOverride, ChannelType
from app.permissions import Context, Overwrite, Perm

MAX_PER_SERVER = 50
ADDONS_NAME = "Addons"

ONLY_ADDONS = "Only addons go in the Addons category"
ADDONS_STAY = "Addons stay in the Addons category"
RESERVED_NAME = "The name Addons is reserved for the addons category"
LOCKED_RENAME = "The Addons category can't be renamed"
LOCKED_DELETE = "The Addons category can't be deleted"


def require_free_name(name: str) -> None:
    """A normal category can't be called "Addons", in any case."""
    if name.strip().casefold() == ADDONS_NAME.casefold():
        raise HTTPException(status.HTTP_409_CONFLICT, detail=RESERVED_NAME)


def require_fits(kind: CategoryKind | None, channel_type: ChannelType) -> None:
    """`kind` None: no category. Addons only in the addons category, and nothing else there."""
    if kind == CategoryKind.addons and channel_type != ChannelType.addon:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=ONLY_ADDONS)
    if kind != CategoryKind.addons and channel_type == ChannelType.addon:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=ADDONS_STAY)


async def addons_category(session: AsyncSession, server_id: uuid.UUID) -> ChannelCategory:
    category = await session.scalar(
        select(ChannelCategory).where(ChannelCategory.server_id == server_id, ChannelCategory.kind == CategoryKind.addons)
    )
    if category is None:
        # Every server gets one on creation and from the migration; this is only a safety net.
        last = await session.scalar(select(func.max(ChannelCategory.position)).where(ChannelCategory.server_id == server_id))
        category = ChannelCategory(
            server_id=server_id, name=ADDONS_NAME, kind=CategoryKind.addons, position=(last + 1) if last is not None else 0
        )
        session.add(category)
        await session.flush()
    return category


async def of_server(session: AsyncSession, server_id: uuid.UUID) -> list[ChannelCategory]:
    return list(
        await session.scalars(
            select(ChannelCategory)
            .where(ChannelCategory.server_id == server_id)
            .order_by(ChannelCategory.position, ChannelCategory.name, ChannelCategory.id)
        )
    )


async def overwrites_of(session: AsyncSession, category_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, list[Overwrite]]:
    ids = list(category_ids)
    result: dict[uuid.UUID, list[Overwrite]] = {c: [] for c in ids}
    if ids:
        for o in await session.scalars(select(ChannelCategoryOverride).where(ChannelCategoryOverride.category_id.in_(ids))):
            result[o.category_id].append(Overwrite(o.target_type, o.target_id, o.allow, o.deny))
    return result


def permissions_in(ctx: Context, user_id: uuid.UUID, overwrites: list[Overwrite]) -> Perm:
    """What the user could do in a text channel synced with the category."""
    return ctx.in_channel(user_id, overwrites, voice=False)


def visible(
    categories: list[ChannelCategory],
    ctx: Context,
    user_id: uuid.UUID,
    overwrites: dict[uuid.UUID, list[Overwrite]],
    seen_channels: Iterable[Channel],
) -> list[ChannelCategory]:
    """Those holding a channel the user sees. Who manages channels also gets the empty ones they
    could see, to fill them in; a private category stays hidden from them too."""
    used = {c.category_id for c in seen_channels}
    manages = bool(ctx.base(user_id) & Perm.MANAGE_CHANNELS)
    return [
        c for c in categories
        if c.id in used or (manages and permissions_in(ctx, user_id, overwrites[c.id]) & Perm.VIEW_CHANNEL)
    ]


def same_overwrites(a: Iterable[Overwrite], b: Iterable[Overwrite]) -> bool:
    return set(a) == set(b)


async def copy_to_channels(session: AsyncSession, overwrites: list[Overwrite], channel_ids: list[uuid.UUID]) -> None:
    """Replaces the channels' overrides with the category's."""
    if not channel_ids:
        return
    await session.execute(delete(ChannelOverride).where(ChannelOverride.channel_id.in_(channel_ids)))
    session.add_all(
        ChannelOverride(channel_id=channel_id, target_type=o.target, target_id=o.target_id, allow=o.allow, deny=o.deny)
        for channel_id in channel_ids
        for o in overwrites
    )
