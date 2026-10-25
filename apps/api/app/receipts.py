"""Read receipts ("visto") in 1:1 DMs.

Built on the read state (app/reads.py): what the other person read is their channel_reads row.
Only in 1:1 DMs, never the official one, and only while both people have "Confirmação de
leitura" on: turning it off hides my reads from them and theirs from me. Servers and groups
don't have it (yet).

Changes go out as "dm.read" {channel_id, last_read_message_id} to the other person, never as
"read.updated": older apps take that event as the viewer's own read state.
"""

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, ChannelMember, ChannelRead, ChannelType, UserSettings
from app.realtime import broker


def applies(channel: Channel) -> bool:
    return channel.type == ChannelType.dm and not channel.is_official


async def _enabled(session: AsyncSession, user_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, bool]:
    ids = set(user_ids)
    rows = await session.execute(select(UserSettings.user_id, UserSettings.read_receipts).where(UserSettings.user_id.in_(ids)))
    off = {user_id for user_id, on in rows if not on}
    return {user_id: user_id not in off for user_id in ids}  # without a settings row: on


async def peer_reads(session: AsyncSession, viewer: uuid.UUID, channels: list[Channel]) -> dict[uuid.UUID, int | None]:
    """For each 1:1 DM, the last message the other person read as `viewer` may see it (None when
    either has receipts off)."""
    dms = [c.id for c in channels if applies(c)]
    if not dms:
        return {}
    peers = dict(
        (await session.execute(
            select(ChannelMember.channel_id, ChannelMember.user_id).where(
                ChannelMember.channel_id.in_(dms), ChannelMember.user_id != viewer
            )
        )).all()
    )
    enabled = await _enabled(session, [viewer, *peers.values()])
    reads = dict(
        (await session.execute(
            select(ChannelRead.channel_id, ChannelRead.last_read_message_id).where(
                ChannelRead.channel_id.in_(dms), ChannelRead.user_id.in_(peers.values())
            )
        )).all()
    )
    out: dict[uuid.UUID, int | None] = {}
    for channel_id, peer in peers.items():
        visible = enabled[viewer] and enabled[peer]
        out[channel_id] = reads.get(channel_id, 0) if visible else None
    return out


async def announce(session: AsyncSession, channel: Channel, reader: uuid.UUID, *, hidden_too: bool = False) -> None:
    """After `reader` read in `channel`: the other person sees it, if receipts apply. Nothing is
    sent while hidden, unless `hidden_too` (the setting just changed and the app must hide it)."""
    if not applies(channel):
        return
    peer = await session.scalar(
        select(ChannelMember.user_id).where(ChannelMember.channel_id == channel.id, ChannelMember.user_id != reader)
    )
    if peer is None:
        return
    seen = (await peer_reads(session, peer, [channel]))[channel.id]
    if seen is None and not hidden_too:
        return
    await broker.publish("dm.read", {"channel_id": str(channel.id), "last_read_message_id": seen}, [peer])


async def announce_setting(session: AsyncSession, user_id: uuid.UUID) -> None:
    """After the user turned receipts on or off: both sides of each of their 1:1 DMs get what
    they may see now."""
    channels = list(
        await session.scalars(
            select(Channel)
            .join(ChannelMember, ChannelMember.channel_id == Channel.id)
            .where(ChannelMember.user_id == user_id, Channel.type == ChannelType.dm, Channel.is_official.is_(False))
        )
    )
    if not channels:
        return
    mine = await peer_reads(session, user_id, channels)
    for channel in channels:
        await broker.publish(
            "dm.read", {"channel_id": str(channel.id), "last_read_message_id": mine[channel.id]}, [user_id]
        )
        await announce(session, channel, user_id, hidden_too=True)
