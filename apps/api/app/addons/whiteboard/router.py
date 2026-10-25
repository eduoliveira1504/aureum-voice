import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.addons.base import AddonChannel, AddonManifest, addon_channel
from app.addons.whiteboard.models import WhiteboardBoard, WhiteboardFile, WhiteboardSnapshot
from app.deps import CurrentUser, SessionDep
from app.permissions import Perm

# Archived boards count too: archiving hides a board, it doesn't free a place.
MAX_BOARDS = 200

router = APIRouter()

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Background = Literal["plain", "grid"]


# --- Schemas --------------------------------------------------------------------


class BoardSummary(BaseModel):
    """A board as the list shows it, without the scene."""

    id: uuid.UUID
    name: str
    background: Background
    version: int
    # Names the current picture, if any: it's fetched (with the token, like attachments) from
    # .../boards/{id}/thumbnail?v=<this>, so a new picture gets a new URL.
    thumbnail: str | None
    created_by: uuid.UUID | None
    updated_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class BoardList(BaseModel):
    boards: list[BoardSummary]
    # Create, draw, rename, duplicate and archive all take "edit".
    can_edit: bool


class BoardOut(BoardSummary):
    # Excalidraw elements, deleted ones included (they keep later edits from reviving them).
    elements: list[dict[str, Any]]
    can_edit: bool


class BoardCreate(BaseModel):
    name: Name
    background: Background = "plain"


class BoardUpdate(BaseModel):
    """Only the fields sent change."""

    name: Name | None = None
    background: Background | None = None
    archived: bool | None = None


# --- Helpers --------------------------------------------------------------------


def workspace_prefix(workspace_id: uuid.UUID) -> str:
    """Where a workspace's images and thumbnails are stored."""
    return f"addons/whiteboard/{workspace_id}/"


async def cleanup(session: AsyncSession, workspace_ids: list[uuid.UUID]) -> list[str]:
    keys = list(await session.scalars(select(WhiteboardFile.key).where(WhiteboardFile.workspace_id.in_(workspace_ids))))
    keys += [
        k
        for k in await session.scalars(
            select(WhiteboardBoard.thumbnail_key).where(WhiteboardBoard.workspace_id.in_(workspace_ids))
        )
        if k
    ]
    for model in (WhiteboardSnapshot, WhiteboardFile, WhiteboardBoard):
        await session.execute(delete(model).where(model.workspace_id.in_(workspace_ids)))
    return keys


def _summary(board: WhiteboardBoard) -> BoardSummary:
    return BoardSummary(
        id=board.id,
        name=board.name,
        background=board.background,  # type: ignore[arg-type]
        version=board.version,
        # Keys are unique per picture: <prefix>/thumbs/<random>.png
        thumbnail=board.thumbnail_key.rsplit("/", 1)[-1].split(".")[0] if board.thumbnail_key else None,
        created_by=board.created_by,
        updated_by=board.updated_by,
        created_at=board.created_at,
        updated_at=board.updated_at,
        archived_at=board.archived_at,
    )


async def _board(session: AsyncSession, ctx: AddonChannel, board_id: uuid.UUID, *, lock: bool = False) -> WhiteboardBoard:
    query = select(WhiteboardBoard).where(WhiteboardBoard.id == board_id, WhiteboardBoard.workspace_id == ctx.workspace_id)
    board = await session.scalar(query.with_for_update() if lock else query)
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Board not found")
    return board


async def _check_room(session: AsyncSession, ctx: AddonChannel) -> None:
    count = await session.scalar(
        select(func.count()).select_from(WhiteboardBoard).where(WhiteboardBoard.workspace_id == ctx.workspace_id)
    )
    if (count or 0) >= MAX_BOARDS:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A channel holds up to {MAX_BOARDS} boards")


async def _created(session: AsyncSession, ctx: AddonChannel, board: WhiteboardBoard) -> BoardSummary:
    session.add(board)
    await session.commit()
    await session.refresh(board)
    out = _summary(board)
    await ctx.publish("board.created", out.model_dump(mode="json"))
    return out


# --- Boards ---------------------------------------------------------------------


@router.get("/channels/{channel_id}/boards", response_model=BoardList)
async def list_boards(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> BoardList:
    """Every board, archived ones included (the app shows them apart); last edited first."""
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    boards = await session.scalars(
        select(WhiteboardBoard)
        .where(WhiteboardBoard.workspace_id == ctx.workspace_id)
        .order_by(WhiteboardBoard.updated_at.desc(), WhiteboardBoard.id)
    )
    return BoardList(boards=[_summary(b) for b in boards], can_edit=ctx.can("edit"))


@router.post("/channels/{channel_id}/boards", response_model=BoardSummary, status_code=status.HTTP_201_CREATED)
async def create_board(channel_id: uuid.UUID, body: BoardCreate, user: CurrentUser, session: SessionDep) -> BoardSummary:
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    await _check_room(session, ctx)
    board = WhiteboardBoard(
        workspace_id=ctx.workspace_id, name=body.name, background=body.background, created_by=user.id, updated_by=user.id
    )
    return await _created(session, ctx, board)


@router.get("/channels/{channel_id}/boards/{board_id}", response_model=BoardOut)
async def get_board(channel_id: uuid.UUID, board_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> BoardOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    board = await _board(session, ctx, board_id)
    return BoardOut(**_summary(board).model_dump(), elements=list(board.elements.values()), can_edit=ctx.can("edit"))


@router.patch("/channels/{channel_id}/boards/{board_id}", response_model=BoardSummary)
async def update_board(
    channel_id: uuid.UUID, board_id: uuid.UUID, body: BoardUpdate, user: CurrentUser, session: SessionDep
) -> BoardSummary:
    """Rename, change the background, archive (archived: true) or bring back (false)."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    board = await _board(session, ctx, board_id, lock=True)
    if body.name is not None and body.name != board.name:
        board.name = body.name
        board.updated_at = datetime.now(UTC)
        board.updated_by = user.id
    if body.background is not None:
        board.background = body.background
    if body.archived is not None and body.archived != (board.archived_at is not None):
        board.archived_at = datetime.now(UTC) if body.archived else None
    await session.commit()
    out = _summary(board)
    await ctx.publish("board.updated", out.model_dump(mode="json"))
    return out


@router.post(
    "/channels/{channel_id}/boards/{board_id}/duplicate", response_model=BoardSummary, status_code=status.HTTP_201_CREATED
)
async def duplicate_board(channel_id: uuid.UUID, board_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> BoardSummary:
    """A new board with the same drawing, named "<name> (cópia)". Images are shared, not copied:
    they belong to the channel. Deleted elements are left behind and versions start over."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    source = await _board(session, ctx, board_id)
    await _check_room(session, ctx)
    elements = {k: e for k, e in source.elements.items() if not e.get("isDeleted")}
    copy = WhiteboardBoard(
        workspace_id=ctx.workspace_id,
        name=f"{source.name[:72]} (cópia)",
        background=source.background,
        elements=elements,
        scene_bytes=source.scene_bytes,
        version=1 if elements else 0,
        created_by=user.id,
        updated_by=user.id,
    )
    return await _created(session, ctx, copy)


manifest = AddonManifest(
    key="whiteboard",
    name="Quadro branco",
    description="Desenho livre, formas, notas e imagens, juntos e ao vivo.",
    icon="presentation",
    router=router,
    permissions={"edit": Perm.EDIT_WHITEBOARD},
    on_cleanup=cleanup,
    announces=True,
)
