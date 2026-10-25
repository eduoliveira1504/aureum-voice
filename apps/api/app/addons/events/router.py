import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from pydantic import AwareDatetime, BaseModel, Field, StringConstraints
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.addons.base import AddonChannel, AddonManifest, DatedItem, addon_channel, event_notice
from app.addons.events import notices, occurrences
from app.addons.events.models import Event, EventResponse
from app.deps import CurrentUser, SessionDep
from app.permissions import Perm

MAX_EVENTS = 500
MAX_COVER_BYTES = 5 * 1024 * 1024
# How long an event may last: a weekly one must end before its next week starts.
MAX_LENGTH = {"none": timedelta(days=14), "weekly": timedelta(days=7)}
# A new event may start a little in the past (created while it's already going on).
MAX_PAST = timedelta(days=1)

router = APIRouter()

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, Field(max_length=4000)]
Place = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Zone = Annotated[str, StringConstraints(min_length=1, max_length=64)]
Repeat = Literal["none", "weekly"]
Answer = Literal["going", "maybe", "no"]


# --- Schemas --------------------------------------------------------------------


class OccurrenceOut(BaseModel):
    index: int
    starts_at: datetime
    ends_at: datetime


class Responses(BaseModel):
    """Who answered what for one occurrence (answers are public in the channel)."""

    going: list[uuid.UUID] = []
    maybe: list[uuid.UUID] = []
    no: list[uuid.UUID] = []


class EventOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    # The first occurrence; a weekly event repeats it every week.
    starts_at: datetime
    ends_at: datetime
    timezone: str
    repeat: Repeat
    location_channel_id: uuid.UUID | None
    location_text: str | None
    # Names the current cover, if any: fetched (with the token) from .../cover?v=<this>.
    cover: str | None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    cancelled_at: datetime | None
    # The occurrence going on now or next; for a one-off event that's over, the one it had.
    occurrence: OccurrenceOut
    # A one-off event that has ended (a weekly one never is).
    over: bool
    responses: Responses


class EventList(BaseModel):
    events: list[EventOut]
    # Create, edit, cancel and delete events.
    can_manage: bool


class EventCreate(BaseModel):
    title: Title
    description: Description = ""
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    timezone: Zone
    repeat: Repeat = "none"
    location_channel_id: uuid.UUID | None = None
    location_text: Place | None = None


class EventUpdate(BaseModel):
    """Only the fields sent change; null clears a place."""

    title: Title | None = None
    description: Description | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    timezone: Zone | None = None
    repeat: Repeat | None = None
    location_channel_id: uuid.UUID | None = None
    location_text: Place | None = None


class ResponseSet(BaseModel):
    # None takes the answer back.
    status: Answer | None


# --- Helpers --------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


def _prefix(workspace_id: uuid.UUID) -> str:
    return f"addons/events/{workspace_id}/"


def _cover_token(key: str | None) -> str | None:
    return key.rsplit("/", 1)[-1].split(".")[0] if key else None


def shown_occurrence(event: Event, now: datetime | None = None) -> tuple[occurrences.Occurrence, bool]:
    """The occurrence to show and answer for: the one going on or next, or, for a one-off event
    that's over, its only one (with True)."""
    occ = occurrences.current(event.starts_at, event.ends_at, event.timezone, event.repeat, now or _now())
    if occ is None:
        return occurrences.Occurrence(0, event.starts_at, event.ends_at), True
    return occ, False


async def _responses(session: AsyncSession, keys: list[tuple[uuid.UUID, int]]) -> dict[tuple[uuid.UUID, int], Responses]:
    out: dict[tuple[uuid.UUID, int], Responses] = {k: Responses() for k in keys}
    if not keys:
        return out
    rows = await session.scalars(
        select(EventResponse)
        .where(EventResponse.event_id.in_({k[0] for k in keys}))
        .order_by(EventResponse.updated_at)
    )
    for row in rows:
        answers = out.get((row.event_id, row.occurrence))
        if answers is not None:
            getattr(answers, row.status).append(row.user_id)
    return out


async def _outs(session: AsyncSession, events: list[Event]) -> list[EventOut]:
    shown = {e.id: shown_occurrence(e) for e in events}
    answers = await _responses(session, [(e.id, shown[e.id][0].index) for e in events])
    out = []
    for e in events:
        occ, over = shown[e.id]
        out.append(
            EventOut(
                id=e.id,
                title=e.title,
                description=e.description,
                starts_at=e.starts_at,
                ends_at=e.ends_at,
                timezone=e.timezone,
                repeat=e.repeat,  # type: ignore[arg-type]
                location_channel_id=e.location_channel_id,
                location_text=e.location_text,
                cover=_cover_token(e.cover_key),
                created_by=e.created_by,
                created_at=e.created_at,
                updated_at=e.updated_at,
                cancelled_at=e.cancelled_at,
                occurrence=OccurrenceOut(index=occ.index, starts_at=occ.starts_at, ends_at=occ.ends_at),
                over=over,
                responses=answers[(e.id, occ.index)],
            )
        )
    return out


async def _out(session: AsyncSession, event: Event) -> EventOut:
    await session.refresh(event)
    [out] = await _outs(session, [event])
    return out


async def _event(session: AsyncSession, ctx: AddonChannel, event_id: uuid.UUID, *, lock: bool = False) -> Event:
    query = select(Event).where(Event.id == event_id, Event.workspace_id == ctx.workspace_id)
    event = await session.scalar(query.with_for_update() if lock else query)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


async def _check(ctx: AddonChannel, event: Event) -> None:
    """What an event must be like after a create or an edit."""
    if event.ends_at <= event.starts_at:
        raise _invalid("The event must end after it starts")
    if event.ends_at - event.starts_at > MAX_LENGTH[event.repeat]:
        raise _invalid("This event is too long" + (" to repeat every week" if event.repeat == "weekly" else ""))
    if not occurrences.valid_zone(event.timezone):
        raise _invalid("Unknown time zone")
    if event.location_channel_id is not None and event.location_text is not None:
        raise _invalid("Pick a voice room or write a place, not both")
    if event.location_channel_id is not None and await ctx.voice_room(event.location_channel_id) is None:
        raise _invalid("The place must be a voice room of this server")


async def _read_cover(upload: UploadFile) -> tuple[bytes, str, str]:
    data = await upload.read(MAX_COVER_BYTES + 1)
    if len(data) > MAX_COVER_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Covers must be at most 5 MB")
    detected = storage.sniff_image(data)
    if detected is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use PNG, JPG, GIF or WebP")
    return data, *detected


async def cleanup(session: AsyncSession, workspace_ids: list[uuid.UUID]) -> list[str]:
    keys = [k for k in await session.scalars(select(Event.cover_key).where(Event.workspace_id.in_(workspace_ids))) if k]
    await session.execute(delete(Event).where(Event.workspace_id.in_(workspace_ids)))
    return keys


async def dated_items(
    session: AsyncSession, workspace_ids: list[uuid.UUID], start: datetime, end: datetime, user_id: uuid.UUID
) -> list[DatedItem]:
    """Each occurrence in the range, cancelled ones marked; `mine` when the user said Vou or
    Talvez to that occurrence."""
    if not workspace_ids:
        return []
    events = list(
        await session.scalars(
            select(Event).where(
                Event.workspace_id.in_(workspace_ids),
                Event.starts_at < end,
                or_(Event.repeat == "weekly", Event.ends_at > start),
            )
        )
    )
    found = [(e, occ) for e in events for occ in occurrences.between(e.starts_at, e.ends_at, e.timezone, e.repeat, start, end)]
    mine: set[tuple[uuid.UUID, int]] = set()
    if found:
        rows = await session.execute(
            select(EventResponse.event_id, EventResponse.occurrence).where(
                EventResponse.event_id.in_({e.id for e, _ in found}),
                EventResponse.user_id == user_id,
                EventResponse.status.in_(("going", "maybe")),
            )
        )
        mine = {(event_id, index) for event_id, index in rows}
    return [
        DatedItem(
            id=f"{e.id}:{occ.index}",
            workspace_id=e.workspace_id,
            item_id=e.id,
            title=e.title,
            kind="event",
            all_day=False,
            starts_at=occ.starts_at,
            ends_at=occ.ends_at,
            cancelled=e.cancelled_at is not None,
            mine=(e.id, occ.index) in mine,
        )
        for e, occ in found
    ]


# --- Routes ---------------------------------------------------------------------


@router.get("/channels/{channel_id}/events", response_model=EventList)
async def list_events(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> EventList:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    events = list(await session.scalars(select(Event).where(Event.workspace_id == ctx.workspace_id).order_by(Event.starts_at)))
    return EventList(events=await _outs(session, events), can_manage=ctx.can("manage"))


@router.get("/channels/{channel_id}/events/{event_id}", response_model=EventOut)
async def get_event(channel_id: uuid.UUID, event_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> EventOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    return (await _outs(session, [await _event(session, ctx, event_id)]))[0]


@router.post("/channels/{channel_id}/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
async def create_event(channel_id: uuid.UUID, body: EventCreate, user: CurrentUser, session: SessionDep) -> EventOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    count = await session.scalar(select(func.count()).select_from(Event).where(Event.workspace_id == ctx.workspace_id))
    if (count or 0) >= MAX_EVENTS:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A channel holds up to {MAX_EVENTS} events")
    if body.starts_at < _now() - MAX_PAST:
        raise _invalid("The event can't start in the past")
    event = Event(workspace_id=ctx.workspace_id, created_by=user.id, **body.model_dump())
    await _check(ctx, event)
    session.add(event)
    await session.commit()
    out = await _out(session, event)
    await ctx.publish("event.created", out.model_dump(mode="json"))
    await ctx.announce(f"criou o evento “{event.title}”", group="event.created")
    return out


@router.patch("/channels/{channel_id}/events/{event_id}", response_model=EventOut)
async def update_event(
    channel_id: uuid.UUID, event_id: uuid.UUID, body: EventUpdate, user: CurrentUser, session: SessionDep
) -> EventOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    event = await _event(session, ctx, event_id, lock=True)
    when = (event.starts_at, event.ends_at, event.timezone, event.repeat)
    for field in body.model_fields_set:
        value = getattr(body, field)
        if value is None and field not in ("location_channel_id", "location_text"):
            continue
        setattr(event, field, value)
    await _check(ctx, event)
    await session.commit()
    out = await _out(session, event)
    await ctx.publish("event.updated", out.model_dump(mode="json"))
    if (event.starts_at, event.ends_at, event.timezone, event.repeat) != when and event.cancelled_at is None and not out.over:
        occ, _ = shown_occurrence(event)
        await notices.notify(session, event, occ, "evento_alterado", f"event:{event.id}:changed:{int(event.updated_at.timestamp())}")
    return out


@router.post("/channels/{channel_id}/events/{event_id}/cancel", response_model=EventOut)
async def cancel_event(channel_id: uuid.UUID, event_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> EventOut:
    """Calls it off (every week, for a weekly one), telling who said Vou or Talvez. It stays
    listed as cancelled."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    event = await _event(session, ctx, event_id, lock=True)
    if event.cancelled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This event was already cancelled")
    event.cancelled_at = _now()
    await session.commit()
    out = await _out(session, event)
    await ctx.publish("event.updated", out.model_dump(mode="json"))
    if not out.over:
        occ, _ = shown_occurrence(event)
        await notices.notify(session, event, occ, "evento_cancelado", f"event:{event.id}:cancelled")
    return out


@router.delete("/channels/{channel_id}/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(channel_id: uuid.UUID, event_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    event = await _event(session, ctx, event_id)
    cover = event.cover_key
    # Deleting one still to come tells who was going, like cancelling it.
    occ, over = shown_occurrence(event)
    told = [] if over or event.cancelled_at is not None else await notices.attending(session, event.id, occ.index)
    title, workspace_id, room, place = event.title, event.workspace_id, event.location_channel_id, event.location_text
    await session.delete(event)
    await session.commit()
    if cover:
        await storage.delete(cover)
    await ctx.publish("event.deleted", {"id": str(event_id)})
    if told:
        await event_notice(
            session, workspace_id, told, "evento_cancelado", key=f"event:{event_id}:cancelled", title=title,
            item_id=event_id, starts_at=occ.starts_at, room_id=room, place=place,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/channels/{channel_id}/events/{event_id}/response", response_model=EventOut)
async def respond(channel_id: uuid.UUID, event_id: uuid.UUID, body: ResponseSet, user: CurrentUser, session: SessionDep) -> EventOut:
    """Vou / Talvez / Não vou for the occurrence going on or next. Whoever sees the channel."""
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    event = await _event(session, ctx, event_id)
    if event.cancelled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This event was cancelled")
    occ, over = shown_occurrence(event)
    if over:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This event is over")
    row = await session.get(EventResponse, (event.id, occ.index, user.id))
    if body.status is None:
        if row is not None:
            await session.delete(row)
    elif row is None:
        session.add(EventResponse(event_id=event.id, occurrence=occ.index, user_id=user.id, status=body.status))
    else:
        row.status = body.status
    await session.commit()
    out = await _out(session, event)
    await ctx.publish("event.updated", out.model_dump(mode="json"))
    return out


@router.put("/channels/{channel_id}/events/{event_id}/cover", response_model=EventOut)
async def set_cover(
    channel_id: uuid.UUID,
    event_id: uuid.UUID,
    file: Annotated[UploadFile, File(description="PNG, JPG, GIF or WebP, up to 5 MB")],
    user: CurrentUser,
    session: SessionDep,
) -> EventOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    data, content_type, ext = await _read_cover(file)
    event = await _event(session, ctx, event_id, lock=True)
    old = event.cover_key
    event.cover_key = f"{_prefix(ctx.workspace_id)}covers/{secrets.token_hex(8)}.{ext}"
    await storage.put(event.cover_key, data, content_type)
    try:
        await session.commit()
    except BaseException:
        await storage.delete(event.cover_key)
        raise
    if old:
        await storage.delete(old)
    out = await _out(session, event)
    await ctx.publish("event.updated", out.model_dump(mode="json"))
    return out


@router.delete("/channels/{channel_id}/events/{event_id}/cover", response_model=EventOut)
async def remove_cover(channel_id: uuid.UUID, event_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> EventOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    event = await _event(session, ctx, event_id, lock=True)
    old, event.cover_key = event.cover_key, None
    await session.commit()
    if old:
        await storage.delete(old)
    out = await _out(session, event)
    await ctx.publish("event.updated", out.model_dump(mode="json"))
    return out


@router.get("/channels/{channel_id}/events/{event_id}/cover")
async def get_cover(channel_id: uuid.UUID, event_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    event = await _event(session, ctx, event_id)
    stored = await storage.get(event.cover_key) if event.cover_key else None
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(
        stored.data,
        media_type=stored.content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )


manifest = AddonManifest(
    key="events",
    name="Eventos",
    description="Encontros marcados, com quem vai e lembretes antes de começar.",
    icon="calendar-days",
    router=router,
    # Managing takes "Gerenciar eventos"; whoever can manage addons there can too.
    permissions={"manage": Perm.MANAGE_EVENTS | Perm.MANAGE_ADDONS},
    on_cleanup=cleanup,
    dated_items=dated_items,
    announces=True,
    worker=notices.run_worker,
)
