"""Forwarding a message to other conversations ("Encaminhar").

The new message keeps a snapshot of the original (`messages.forwarded_from`), not a live link: if
the original is deleted later, the forwarded copy stays. Its files get their own attachment rows
in the destination (same stored file), so downloads are checked against the destination channel.
A stored file is only deleted once no row points to it anymore (attachments.delete_keys).
"""

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import attachments, ratelimit
from app.access import get_channel_access
from app.messages import chat_channel, post_message, require_dm_friends
from app.models import Attachment, Channel, Message, Server
from app.permissions import Perm
from app.schemas import MessageOut

MAX_TARGETS = 5
# Forwards (one per destination) a person can send per minute.
PER_MINUTE = 20


async def _source_of(session: AsyncSession, message: Message, channel: Channel) -> dict[str, Any]:
    """Where the original was. A private conversation says only that: who was in it stays there."""
    if channel.server_id is None:
        return {"kind": "dm"}
    server = await session.get(Server, channel.server_id)
    return {
        "kind": "server",
        "server_id": str(channel.server_id),
        "server_name": server.name if server else "",
        "channel_id": str(channel.id),
        "channel_name": channel.name or "",
        "message_id": message.id,
    }


async def snapshot(session: AsyncSession, message: Message, channel: Channel) -> dict[str, Any]:
    """What a forward of `message` carries. Forwarding a forward (with no comment of its own)
    passes the first one on, so the origin stays the real one."""
    if message.forwarded_from and not message.content:
        return message.forwarded_from
    return {
        "content": message.content,
        "created_at": message.created_at.isoformat(),
        "source": await _source_of(session, message, channel),
    }


async def forward(
    session: AsyncSession, user_id: uuid.UUID, message_id: int, channel_ids: list[uuid.UUID], comment: str
) -> list[MessageOut]:
    """Sends a copy of the message to each channel, with `comment` as the new message's text.
    Checks everything first: nothing is sent unless the user may send to every destination."""
    original = await session.get(Message, message_id)
    if original is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found")
    source_channel, _ = await get_channel_access(session, original.channel_id, user_id)
    if original.call_id is not None or original.system is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This line can't be forwarded")

    files = list(await session.scalars(select(Attachment).where(Attachment.message_id == original.id)))
    order = {a["id"]: i for i, a in enumerate(original.attachments)}
    files.sort(key=lambda a: order.get(str(a.id), len(order)))
    targets: list[Channel] = []
    for channel_id in dict.fromkeys(channel_ids):
        channel, access = await chat_channel(session, channel_id, user_id)
        await require_dm_friends(session, channel, user_id)
        if access is not None:
            needed = Perm.SEND_MESSAGES | (Perm.ATTACH_FILES if files else 0)
            if access.channel(channel) & needed != needed:
                raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't send messages in one of these conversations")
        targets.append(channel)
    for _ in targets:
        await ratelimit.hit(f"forward:{user_id}", PER_MINUTE, 60)

    carried = await snapshot(session, original, source_channel)
    sent = []
    for channel in targets:

        def copy_files(message: Message, channel: Channel = channel) -> None:
            copies = [
                Attachment(
                    id=uuid.uuid4(),
                    channel_id=channel.id,
                    message_id=message.id,
                    uploader_id=user_id,
                    key=f.key,
                    filename=f.filename,
                    kind=f.kind,
                    content_type=f.content_type,
                    size=f.size,
                    meta=f.meta,
                )
                for f in files
            ]
            session.add_all(copies)
            message.attachments = [attachments.out(c) for c in copies]

        sent.append(await post_message(session, channel, user_id, comment, forwarded_from=carried, on_saved=copy_files))
    return sent
