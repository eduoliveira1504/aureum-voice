"""Private calls: start one in a DM/group, ring more people, decline, and missed calls.

Joining and leaving go through the voice flow (POST /channels/{id}/voice/token, then
voice.update over the WebSocket), like server voice channels.
"""

import uuid

from fastapi import APIRouter, HTTPException, Response, status

from app import calls, dms
from app.access import get_channel_access
from app.deps import CurrentUser, SessionDep
from app.models import Call, ChannelMember
from app.schemas import CallOut, CallRing

router = APIRouter(tags=["calls"])


async def _my_active_call(session: SessionDep, call_id: uuid.UUID, user_id: uuid.UUID) -> Call:
    call = await session.get(Call, call_id)
    if call is None or await session.get(ChannelMember, (call.channel_id, user_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Call not found")
    if call.ended_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This call is over")
    return call


@router.post("/channels/{channel_id}/call", response_model=CallOut, status_code=status.HTTP_201_CREATED)
async def start_call(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep, response: Response) -> Call:
    """Starts a call and rings everyone else, or returns the call in progress (200). The caller
    then joins it like any voice channel."""
    channel, _ = await get_channel_access(session, channel_id, user.id)
    if channel.type not in dms.DM_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Calls are for DMs and groups; servers have voice rooms")
    call, created = await calls.start(session, channel, user.id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return call


@router.post("/calls/{call_id}/ring", response_model=CallOut)
async def ring(call_id: uuid.UUID, body: CallRing, user: CurrentUser, session: SessionDep) -> Call:
    """Rings people into the call: members who missed it, or friends from outside (they join the
    group; from a 1:1 DM the call moves to a new group, see app.calls)."""
    call = await _my_active_call(session, call_id, user.id)
    return await calls.ring(session, call, user.id, body.user_ids)


@router.post("/calls/{call_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline(call_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    call = await _my_active_call(session, call_id, user.id)
    await calls.decline(session, call, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/calls/missed", response_model=list[CallOut])
async def missed_calls(user: CurrentUser, session: SessionDep) -> list[Call]:
    """Calls you didn't answer that you haven't seen yet. Reading the conversation clears them."""
    return await calls.missed(session, user.id)
