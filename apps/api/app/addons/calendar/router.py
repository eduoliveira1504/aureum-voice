import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.addons.base import AddonManifest, AgendaItem, AgendaSource, addon_channel
from app.deps import CurrentUser, SessionDep

# A month view with the days around it fits in six weeks.
MAX_RANGE = timedelta(days=62)

router = APIRouter()


class CalendarOut(BaseModel):
    items: list[AgendaItem]
    # Where items can come from: the addon channels with dates the user can see (for filters).
    sources: list[AgendaSource]


@router.get("/channels/{channel_id}/items", response_model=CalendarOut)
async def items(channel_id: uuid.UUID, start: datetime, end: datetime, user: CurrentUser, session: SessionDep) -> CalendarOut:
    """Everything with a date between `start` and `end` in the server's other addons (events, the
    Kanban board's due dates...), each only from channels the user can see. Keeps nothing itself."""
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    start, end = (d if d.tzinfo else d.replace(tzinfo=UTC) for d in (start, end))
    if not start < end <= start + MAX_RANGE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The range must be positive and up to 62 days")
    found, sources = await ctx.agenda(start, end)
    return CalendarOut(items=found, sources=sources)


manifest = AddonManifest(
    key="calendar",
    name="Calendário",
    description="Eventos e prazos do servidor num calendário só.",
    icon="calendar",
    router=router,
)
