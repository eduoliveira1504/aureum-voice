"""Home hub (Início): one request for what the app doesn't already hold (see app/home.py)."""

from fastapi import APIRouter

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
