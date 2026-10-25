import uuid
from collections.abc import Sequence
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.addons.base import AddonChannel, AddonManifest, AssignedItem, ItemLabel, addon_channel
from app.addons.kanban.models import KanbanCard, KanbanColumn, KanbanEvent, KanbanLabel
from app.deps import CurrentUser, SessionDep
from app.permissions import Perm

MAX_COLUMNS = 20
MAX_LABELS = 30
MAX_CARDS = 2000
MAX_CARD_LABELS = 10
DEFAULT_COLUMNS = (("A fazer", "todo"), ("Fazendo", "doing"), ("Feito", "done"))

router = APIRouter()

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, Field(max_length=5000)]
ColumnName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
LabelName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
LabelIds = Annotated[list[uuid.UUID], Field(max_length=MAX_CARD_LABELS)]
Stage = Literal["todo", "doing", "done"]
Color = Literal["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"]
Position = Annotated[int, Field(ge=0)]


# --- Schemas --------------------------------------------------------------------


class ColumnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    stage: Stage
    position: int


class LabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: Color


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    column_id: uuid.UUID
    title: str
    description: str
    assignee_id: uuid.UUID | None
    label_ids: list[uuid.UUID]
    due_date: date | None
    position: int
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class BoardOut(BaseModel):
    columns: list[ColumnOut]
    labels: list[LabelOut]
    cards: list[CardOut]
    # Cards: create, edit, move, delete. Columns and labels need "manage".
    can_edit: bool
    can_manage: bool


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: uuid.UUID | None
    actor_id: uuid.UUID | None
    action: str
    data: dict[str, Any]
    created_at: datetime


class CardCreate(BaseModel):
    column_id: uuid.UUID
    title: Title
    description: Description = ""
    assignee_id: uuid.UUID | None = None
    label_ids: LabelIds = []
    due_date: date | None = None


class CardUpdate(BaseModel):
    """Only the fields sent change; null clears the assignee or the due date."""

    title: Title | None = None
    description: Description | None = None
    assignee_id: uuid.UUID | None = None
    label_ids: LabelIds | None = None
    due_date: date | None = None


class CardMove(BaseModel):
    column_id: uuid.UUID
    # Index among the column's cards; past the end means last.
    position: Position


class ColumnCreate(BaseModel):
    name: ColumnName
    stage: Stage = "todo"


class ColumnUpdate(BaseModel):
    name: ColumnName | None = None
    stage: Stage | None = None


class ColumnMove(BaseModel):
    position: Position


class LabelCreate(BaseModel):
    name: LabelName
    color: Color = "gray"


class LabelUpdate(BaseModel):
    name: LabelName | None = None
    color: Color | None = None


# --- Helpers --------------------------------------------------------------------


async def cleanup(session: AsyncSession, workspace_ids: list[uuid.UUID]) -> None:
    for model in (KanbanEvent, KanbanCard, KanbanLabel, KanbanColumn):
        await session.execute(delete(model).where(model.workspace_id.in_(workspace_ids)))


async def assigned(session: AsyncSession, workspace_ids: list[uuid.UUID], user_id: uuid.UUID) -> list[AssignedItem]:
    """The user's cards in columns not marked done, in these workspaces."""
    if not workspace_ids:
        return []
    rows = (
        await session.execute(
            select(KanbanCard, KanbanColumn.name)
            .join(KanbanColumn, KanbanColumn.id == KanbanCard.column_id)
            .where(
                KanbanCard.workspace_id.in_(workspace_ids),
                KanbanCard.assignee_id == user_id,
                KanbanColumn.stage != "done",
            )
        )
    ).all()
    label_ids = {label_id for card, _ in rows for label_id in card.label_ids}
    labels: dict[uuid.UUID, KanbanLabel] = {}
    if label_ids:
        labels = {label.id: label for label in await session.scalars(select(KanbanLabel).where(KanbanLabel.id.in_(label_ids)))}
    return [
        AssignedItem(
            id=card.id,
            workspace_id=card.workspace_id,
            title=card.title,
            status=column_name,
            labels=[ItemLabel(name=labels[i].name, color=labels[i].color) for i in card.label_ids if i in labels],
            due_date=card.due_date,
            updated_at=card.updated_at,
        )
        for card, column_name in rows
    ]


async def _lock(session: AsyncSession, workspace_id: uuid.UUID) -> None:
    """Serializes changes to one board (until commit), so positions stay consistent."""
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"addon_kanban:{workspace_id}"})


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{what} not found")


async def _column(session: AsyncSession, ctx: AddonChannel, column_id: uuid.UUID) -> KanbanColumn:
    column = await session.get(KanbanColumn, column_id)
    if column is None or column.workspace_id != ctx.workspace_id:
        raise _not_found("Column")
    return column


async def _card(session: AsyncSession, ctx: AddonChannel, card_id: uuid.UUID) -> KanbanCard:
    card = await session.get(KanbanCard, card_id)
    if card is None or card.workspace_id != ctx.workspace_id:
        raise _not_found("Card")
    return card


async def _label(session: AsyncSession, ctx: AddonChannel, label_id: uuid.UUID) -> KanbanLabel:
    label = await session.get(KanbanLabel, label_id)
    if label is None or label.workspace_id != ctx.workspace_id:
        raise _not_found("Label")
    return label


async def _count(session: AsyncSession, model: Any, workspace_id: uuid.UUID) -> int:
    return await session.scalar(select(func.count()).select_from(model).where(model.workspace_id == workspace_id)) or 0


async def _check_assignee(ctx: AddonChannel, assignee_id: uuid.UUID | None) -> None:
    if assignee_id is not None and assignee_id not in await ctx.member_ids():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The assignee must be able to see the board")


async def _check_labels(session: AsyncSession, ctx: AddonChannel, label_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    ids = list(dict.fromkeys(label_ids))
    if ids:
        found = await session.scalar(
            select(func.count())
            .select_from(KanbanLabel)
            .where(KanbanLabel.workspace_id == ctx.workspace_id, KanbanLabel.id.in_(ids))
        )
        if found != len(ids):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown label")
    return ids


def _log(
    session: AsyncSession, ctx: AddonChannel, action: str, card_id: uuid.UUID | None = None, **data: Any
) -> None:
    session.add(
        KanbanEvent(workspace_id=ctx.workspace_id, card_id=card_id, actor_id=ctx.access.user_id, action=action, data=data)
    )


def _reindex(items: Sequence[KanbanCard | KanbanColumn]) -> None:
    for i, item in enumerate(items):
        item.position = i


async def _column_cards(session: AsyncSession, column_id: uuid.UUID, *, without: uuid.UUID | None = None) -> list[KanbanCard]:
    query = select(KanbanCard).where(KanbanCard.column_id == column_id)
    if without is not None:
        query = query.where(KanbanCard.id != without)
    return list(await session.scalars(query.order_by(KanbanCard.position, KanbanCard.created_at)))


async def _columns(session: AsyncSession, workspace_id: uuid.UUID) -> list[KanbanColumn]:
    query = select(KanbanColumn).where(KanbanColumn.workspace_id == workspace_id)
    return list(await session.scalars(query.order_by(KanbanColumn.position, KanbanColumn.name)))


async def _card_out(session: AsyncSession, card: KanbanCard) -> CardOut:
    # Timestamps are set by the database.
    await session.refresh(card)
    return CardOut.model_validate(card)


def _positions(cards: list[KanbanCard]) -> dict[str, Any]:
    return {"cards": [{"id": str(c.id), "column_id": str(c.column_id), "position": c.position} for c in cards]}


# --- Board ----------------------------------------------------------------------


@router.get("/channels/{channel_id}", response_model=BoardOut)
async def get_board(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> BoardOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    ws = ctx.workspace_id
    columns = await _columns(session, ws)
    if not columns:
        # A new board starts with the usual three columns.
        await _lock(session, ws)
        columns = await _columns(session, ws)
        if not columns:
            columns = [
                KanbanColumn(workspace_id=ws, name=name, stage=stage, position=i)
                for i, (name, stage) in enumerate(DEFAULT_COLUMNS)
            ]
            session.add_all(columns)
        await session.commit()
    labels = await session.scalars(select(KanbanLabel).where(KanbanLabel.workspace_id == ws).order_by(KanbanLabel.name))
    cards = await session.scalars(
        select(KanbanCard).where(KanbanCard.workspace_id == ws).order_by(KanbanCard.position, KanbanCard.created_at)
    )
    return BoardOut(
        columns=[ColumnOut.model_validate(c) for c in columns],
        labels=[LabelOut.model_validate(label) for label in labels],
        cards=[CardOut.model_validate(c) for c in cards],
        can_edit=ctx.can("edit"),
        can_manage=ctx.can("manage"),
    )


@router.get("/channels/{channel_id}/history", response_model=list[EventOut])
async def history(
    channel_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    card_id: uuid.UUID | None = None,
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[KanbanEvent]:
    """Newest first: the whole board's, or one card's."""
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    query = select(KanbanEvent).where(KanbanEvent.workspace_id == ctx.workspace_id)
    if card_id is not None:
        query = query.where(KanbanEvent.card_id == card_id)
    if before is not None:
        query = query.where(KanbanEvent.id < before)
    return list(await session.scalars(query.order_by(KanbanEvent.id.desc()).limit(limit)))


# --- Cards ----------------------------------------------------------------------


@router.post("/channels/{channel_id}/cards", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def create_card(channel_id: uuid.UUID, body: CardCreate, user: CurrentUser, session: SessionDep) -> CardOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    await _lock(session, ctx.workspace_id)
    column = await _column(session, ctx, body.column_id)
    if await _count(session, KanbanCard, ctx.workspace_id) >= MAX_CARDS:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A board holds up to {MAX_CARDS} cards")
    await _check_assignee(ctx, body.assignee_id)
    last = await session.scalar(select(func.max(KanbanCard.position)).where(KanbanCard.column_id == column.id))
    card = KanbanCard(
        workspace_id=ctx.workspace_id,
        column_id=column.id,
        title=body.title,
        description=body.description,
        assignee_id=body.assignee_id,
        label_ids=await _check_labels(session, ctx, body.label_ids),
        due_date=body.due_date,
        position=(last + 1) if last is not None else 0,
        created_by=user.id,
    )
    session.add(card)
    await session.flush()
    _log(session, ctx, "card.created", card.id, title=card.title, column=column.name)
    await session.commit()
    out = await _card_out(session, card)
    await ctx.publish("card.created", out.model_dump(mode="json"))
    return out


@router.patch("/channels/{channel_id}/cards/{card_id}", response_model=CardOut)
async def update_card(
    channel_id: uuid.UUID, card_id: uuid.UUID, body: CardUpdate, user: CurrentUser, session: SessionDep
) -> CardOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    card = await _card(session, ctx, card_id)
    sent = body.model_fields_set
    changed: list[str] = []
    if body.title is not None and body.title != card.title:
        card.title = body.title
        changed.append("title")
    if body.description is not None and body.description != card.description:
        card.description = body.description
        changed.append("description")
    if "assignee_id" in sent and body.assignee_id != card.assignee_id:
        await _check_assignee(ctx, body.assignee_id)
        card.assignee_id = body.assignee_id
        changed.append("assignee")
    if body.label_ids is not None:
        label_ids = await _check_labels(session, ctx, body.label_ids)
        if label_ids != card.label_ids:
            card.label_ids = label_ids
            changed.append("labels")
    if "due_date" in sent and body.due_date != card.due_date:
        card.due_date = body.due_date
        changed.append("due_date")
    if not changed:
        return CardOut.model_validate(card)
    _log(session, ctx, "card.updated", card.id, title=card.title, fields=changed)
    await session.commit()
    out = await _card_out(session, card)
    await ctx.publish("card.updated", out.model_dump(mode="json"))
    return out


@router.post("/channels/{channel_id}/cards/{card_id}/move", response_model=CardOut)
async def move_card(channel_id: uuid.UUID, card_id: uuid.UUID, body: CardMove, user: CurrentUser, session: SessionDep) -> CardOut:
    """Puts the card at `position` in `column_id` (same or another column). A move to another
    column goes into the history and, when the board has an announce channel, into the chat."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    await _lock(session, ctx.workspace_id)
    card = await _card(session, ctx, card_id)
    target = await _column(session, ctx, body.column_id)
    source = await _column(session, ctx, card.column_id)
    siblings = await _column_cards(session, target.id, without=card.id)
    siblings.insert(min(body.position, len(siblings)), card)
    card.column_id = target.id
    _reindex(siblings)
    touched = siblings
    if source.id != target.id:
        rest = await _column_cards(session, source.id, without=card.id)
        _reindex(rest)
        touched = [*siblings, *rest]
        _log(session, ctx, "card.moved", card.id, title=card.title, **{"from": source.name, "to": target.name})
    await session.commit()
    await ctx.publish("cards.moved", _positions(touched))
    if source.id != target.id:
        await ctx.announce(f"moveu “{card.title}” para {target.name}", group="card.moved")
    return await _card_out(session, card)


@router.delete("/channels/{channel_id}/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(channel_id: uuid.UUID, card_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    card = await _card(session, ctx, card_id)
    _log(session, ctx, "card.deleted", card.id, title=card.title)
    await session.delete(card)
    await session.commit()
    await ctx.publish("card.deleted", {"id": str(card_id)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Columns --------------------------------------------------------------------


@router.post("/channels/{channel_id}/columns", response_model=ColumnOut, status_code=status.HTTP_201_CREATED)
async def create_column(channel_id: uuid.UUID, body: ColumnCreate, user: CurrentUser, session: SessionDep) -> ColumnOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    await _lock(session, ctx.workspace_id)
    columns = await _columns(session, ctx.workspace_id)
    if len(columns) >= MAX_COLUMNS:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A board holds up to {MAX_COLUMNS} columns")
    column = KanbanColumn(workspace_id=ctx.workspace_id, name=body.name, stage=body.stage, position=len(columns))
    session.add(column)
    _log(session, ctx, "column.created", name=column.name)
    await session.commit()
    out = ColumnOut.model_validate(column)
    await ctx.publish("column.created", out.model_dump(mode="json"))
    return out


@router.patch("/channels/{channel_id}/columns/{column_id}", response_model=ColumnOut)
async def update_column(
    channel_id: uuid.UUID, column_id: uuid.UUID, body: ColumnUpdate, user: CurrentUser, session: SessionDep
) -> ColumnOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    column = await _column(session, ctx, column_id)
    old_name = column.name
    if body.name is not None:
        column.name = body.name
    if body.stage is not None:
        column.stage = body.stage
    _log(session, ctx, "column.updated", name=column.name, old_name=old_name)
    await session.commit()
    out = ColumnOut.model_validate(column)
    await ctx.publish("column.updated", out.model_dump(mode="json"))
    return out


@router.post("/channels/{channel_id}/columns/{column_id}/move", response_model=list[ColumnOut])
async def move_column(
    channel_id: uuid.UUID, column_id: uuid.UUID, body: ColumnMove, user: CurrentUser, session: SessionDep
) -> list[ColumnOut]:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    await _lock(session, ctx.workspace_id)
    column = await _column(session, ctx, column_id)
    columns = [c for c in await _columns(session, ctx.workspace_id) if c.id != column.id]
    columns.insert(min(body.position, len(columns)), column)
    _reindex(columns)
    await session.commit()
    out = [ColumnOut.model_validate(c) for c in columns]
    await ctx.publish("columns.moved", {"columns": [c.model_dump(mode="json") for c in out]})
    return out


@router.delete("/channels/{channel_id}/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_column(channel_id: uuid.UUID, column_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Only empty columns go, and a board keeps at least one."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    await _lock(session, ctx.workspace_id)
    column = await _column(session, ctx, column_id)
    if await session.scalar(select(func.count()).select_from(KanbanCard).where(KanbanCard.column_id == column.id)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Move or delete the column's cards first")
    if await _count(session, KanbanColumn, ctx.workspace_id) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="A board needs at least one column")
    _log(session, ctx, "column.deleted", name=column.name)
    await session.delete(column)
    await session.commit()
    await ctx.publish("column.deleted", {"id": str(column_id)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Labels ---------------------------------------------------------------------


@router.post("/channels/{channel_id}/labels", response_model=LabelOut, status_code=status.HTTP_201_CREATED)
async def create_label(channel_id: uuid.UUID, body: LabelCreate, user: CurrentUser, session: SessionDep) -> LabelOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    await _lock(session, ctx.workspace_id)
    if await _count(session, KanbanLabel, ctx.workspace_id) >= MAX_LABELS:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A board holds up to {MAX_LABELS} labels")
    label = KanbanLabel(workspace_id=ctx.workspace_id, name=body.name, color=body.color)
    session.add(label)
    await session.commit()
    out = LabelOut.model_validate(label)
    await ctx.publish("label.created", out.model_dump(mode="json"))
    return out


@router.patch("/channels/{channel_id}/labels/{label_id}", response_model=LabelOut)
async def update_label(
    channel_id: uuid.UUID, label_id: uuid.UUID, body: LabelUpdate, user: CurrentUser, session: SessionDep
) -> LabelOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    label = await _label(session, ctx, label_id)
    if body.name is not None:
        label.name = body.name
    if body.color is not None:
        label.color = body.color
    await session.commit()
    out = LabelOut.model_validate(label)
    await ctx.publish("label.updated", out.model_dump(mode="json"))
    return out


@router.delete("/channels/{channel_id}/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_label(channel_id: uuid.UUID, label_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Also takes the label off every card that had it."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "manage")
    label = await _label(session, ctx, label_id)
    await session.execute(
        update(KanbanCard)
        .where(KanbanCard.workspace_id == ctx.workspace_id, KanbanCard.label_ids.any(label.id))
        .values(label_ids=func.array_remove(KanbanCard.label_ids, label.id))
    )
    await session.delete(label)
    await session.commit()
    await ctx.publish("label.deleted", {"id": str(label_id)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


manifest = AddonManifest(
    key="kanban",
    name="Kanban",
    description="Colunas e cards para organizar o que o grupo está fazendo.",
    icon="square-kanban",
    router=router,
    permissions={"edit": Perm.SEND_MESSAGES, "manage": Perm.MANAGE_ADDONS},
    on_cleanup=cleanup,
    assigned=assigned,
    announces=True,
)
