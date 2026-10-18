"""Voice moderation: server mute, server deafen, and moving members between a server's rooms."""

import uuid

from fastapi import APIRouter, HTTPException, status

from app import livekit_admin, presence, voice
from app.access import server_member_ids
from app.deps import CurrentUser, SessionDep
from app.models import Channel, ChannelType, ServerMember
from app.permissions import Perm, channel_viewers, server_access
from app.realtime import broker
from app.routers.channels import moderated_sources, voice_sources
from app.routers.servers import member_out
from app.schemas import MemberOut, VoiceModeration

router = APIRouter(tags=["moderation"])


@router.patch("/servers/{server_id}/members/{user_id}/voice", response_model=MemberOut)
async def moderate_voice(
    server_id: uuid.UUID, user_id: uuid.UUID, body: VoiceModeration, user: CurrentUser, session: SessionDep
) -> MemberOut:
    """Each change needs its permission (MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS) in the room
    the member is in (server-wide if they aren't in one), and a rank above theirs. Mute and
    deafen last until lifted, also across calls. A move needs both to be able to join the room."""
    scope = voice.server_scope(server_id)
    current = await voice.current_state(user_id)
    state = current[1] if current and current[0] == scope else None
    rooms = [c for c in (state.channel_id if state else None, body.channel_id) if c]
    access = await server_access(session, server_id, user.id, rooms)
    member = await session.get(ServerMember, (server_id, user_id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
    room = await session.get(Channel, state.channel_id) if state else None
    perms = access.channel(room) if room else access.base

    def require(perm: Perm) -> None:
        if not perms & perm:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You don't have permission to do this")

    if body.muted is not None:
        require(Perm.MUTE_MEMBERS)
    if body.deafened is not None:
        require(Perm.DEAFEN_MEMBERS)
    target = None
    if body.channel_id is not None:
        require(Perm.MOVE_MEMBERS)
        if state is None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="They aren't in a voice room")
        target = await session.get(Channel, body.channel_id)
        if target is None or target.server_id != server_id or target.type != ChannelType.voice or not access.can_view(target):
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Room not found")
        if not access.channel(target) & Perm.CONNECT:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't join that room")
        if not access.of_member(user_id, target) & Perm.CONNECT:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="They can't join that room")
    if user_id != user.id:
        access.require_outranks(access.ctx.rank(user_id), "this member")

    if body.muted is not None:
        member.voice_muted = body.muted
    if body.deafened is not None:
        member.voice_deafened = body.deafened
    await session.commit()
    await session.refresh(member)

    if state is not None:
        async def recipients(_: voice.Scope, channel_id: uuid.UUID) -> list[uuid.UUID]:
            channel = await session.get(Channel, channel_id)
            return await channel_viewers(session, channel) if channel else await server_member_ids(session, server_id)

        new_state = state.model_copy(update={"channel_id": target.id if target else state.channel_id})
        voice.apply_moderation(new_state, muted=member.voice_muted, deafened=member.voice_deafened)
        await voice.set_state(new_state, scope, recipients)
        if target is not None:
            # Their app follows into the new room (with a new token for it).
            await broker.publish("voice.moved", {"server_id": str(server_id), "channel_id": str(target.id)}, [user_id])
        elif room is not None and (body.muted is not None or body.deafened is not None):
            # The media server enforces it too, so a modified client can't ignore it.
            their_perms = access.of_member(user_id, room)
            if their_perms & Perm.CONNECT:
                await livekit_admin.restrict(
                    str(room.id),
                    str(user_id),
                    sources=moderated_sources(voice_sources(their_perms), member),
                    can_subscribe=not member.voice_deafened,
                )

    out = member_out(member, access.ctx, (await presence.statuses([user_id]))[user_id])
    await broker.publish(
        "server.member.updated",
        {"server_id": str(server_id), "member": out.model_dump(mode="json")},
        await server_member_ids(session, server_id),
    )
    return out
