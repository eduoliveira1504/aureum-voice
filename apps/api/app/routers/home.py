"""Home hub (Início): one request for what the app doesn't already hold (see app/home.py)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app import home, reads
from app.deps import CurrentUser, SessionDep
from app.realtime import broker
from app.schemas import ReadStateOut

router = APIRouter(prefix="/users/me", tags=["home"])


@router.get("/home", response_model=home.HomeOut)
async def get_home(user: CurrentUser, session: SessionDep) -> home.HomeOut:
    return await home.load(session, user)


@router.get("/tasks", response_model=list[home.HomeTask])
async def get_tasks(user: CurrentUser, session: SessionDep) -> list[home.HomeTask]:
    """All of "Minhas tarefas" (Home shows the first few)."""
    return await home.my_tasks(session, user.id)


AGENDA_MAX_DAYS = 62


@router.get("/agenda", response_model=list[home.AgendaItem])
async def get_agenda(
    user: CurrentUser,
    session: SessionDep,
    start: datetime,
    end: datetime,
    server_id: uuid.UUID | None = None,
    mine: Annotated[bool, Query()] = False,
) -> list[home.AgendaItem]:
    """What has a date in the addons the user can see (events, cards' due dates), from `start` to
    `end` (up to AGENDA_MAX_DAYS apart; without a zone they're UTC). The app asks with its own
    day boundaries, so "today" is the user's today."""
    start, end = (d if d.tzinfo else d.replace(tzinfo=UTC) for d in (start, end))
    if not start < end <= start + timedelta(days=AGENDA_MAX_DAYS):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"The range must be positive and up to {AGENDA_MAX_DAYS} days")
    return await home.agenda(session, user.id, start, end, server_id=server_id, mine=mine)


@router.post("/home/read", response_model=list[ReadStateOut])
async def mark_home_read(user: CurrentUser, session: SessionDep) -> list[ReadStateOut]:
    """"Marcar tudo como lido": the channels with unread mentions and the unread DMs."""
    channels = await home.pending_channels(session, user.id)
    states = []
    for channel_id in channels:
        last_read, unread = await reads.mark_read(session, user.id, channel_id, None)
        states.append(ReadStateOut(channel_id=channel_id, last_read_message_id=last_read, unread_count=unread, mention_count=0))
    await session.commit()
    for state in states:
        # The user's other devices clear their badges too.
        server_id = channels[state.channel_id]
        data = {**state.model_dump(mode="json"), "server_id": str(server_id) if server_id else None}
        await broker.publish("read.updated", data, [user.id])
    return states
