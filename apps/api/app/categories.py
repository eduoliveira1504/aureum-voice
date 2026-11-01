"""Channel categories (block 3.12; see docs/decisions/0037-channel-categories.md).

Access is always decided by each channel's own overrides. A category's overrides are a template:
while a channel is `permissions_synced`, it holds a copy of them. So nothing that checks access
knows categories exist, and a channel is never opened by landing in a category: moving keeps its
permissions, and it counts as synced only if they already match.
"""

import uuid
from collections.abc import Iterable

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, ChannelCategory, ChannelCategoryOverride, ChannelOverride
from app.permissions import Context, Overwrite, Perm

MAX_PER_SERVER = 50


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
