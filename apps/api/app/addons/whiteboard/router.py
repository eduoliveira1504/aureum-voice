import json
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.addons.base import AddonChannel, AddonManifest, addon_channel
from app.addons.whiteboard import live
from app.addons.whiteboard.models import ELEMENT_TYPES, WhiteboardBoard, WhiteboardFile, WhiteboardSnapshot
from app.deps import CurrentUser, SessionDep
from app.permissions import Perm

# Archived boards count too: archiving hides a board, it doesn't free a place.
MAX_BOARDS = 200
# The scene as JSON; images don't count (they're stored apart).
MAX_SCENE_BYTES = 5 * 1024 * 1024
MAX_ELEMENTS_PER_SAVE = 2000
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_THUMBNAIL_BYTES = 512 * 1024
# A version is kept when someone edits after this long without one, then the last MAX_SNAPSHOTS.
SNAPSHOT_EVERY = timedelta(minutes=10)
MAX_SNAPSHOTS = 50

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


class Element(BaseModel):
    """An Excalidraw element. Only what the merge needs is checked; the rest is kept as is."""

    model_config = ConfigDict(extra="allow")

    id: Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
    type: str
    version: Annotated[int, Field(ge=1, lt=2**31)]
    # Excalidraw's names.
    versionNonce: Annotated[int, Field(ge=-(2**31), lt=2**32)]  # noqa: N815
    isDeleted: bool = False  # noqa: N815


class ElementsSave(BaseModel):
    elements: Annotated[list[Element], Field(max_length=MAX_ELEMENTS_PER_SAVE)]
    # Picked by the sending app; it skips its own changes when they come back live.
    origin: Annotated[str, StringConstraints(max_length=64)] | None = None


class SaveOut(BaseModel):
    version: int
    # How many of the elements sent were newer than the saved ones.
    accepted: int


class FileOut(BaseModel):
    file_id: str
    content_type: str


class VersionOut(BaseModel):
    id: int
    author_id: uuid.UUID | None
    created_at: datetime


class VersionScene(VersionOut):
    elements: list[dict[str, Any]]


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


def _size(element: dict[str, Any]) -> int:
    return len(json.dumps(element, separators=(",", ":"), ensure_ascii=False).encode())


def _scene_bytes(elements: dict[str, dict[str, Any]]) -> int:
    return sum(_size(e) for e in elements.values())


def _wins(incoming: dict[str, Any], current: dict[str, Any] | None) -> bool:
    """Excalidraw's own rule, so every app and the server agree: the higher version wins, and on
    a tie the lower versionNonce."""
    if current is None:
        return True
    if incoming["version"] != current["version"]:
        return incoming["version"] > current["version"]
    return incoming["versionNonce"] < current["versionNonce"]


def _keep_version(session: AsyncSession, board: WhiteboardBoard) -> None:
    """Saves the board as it is now as a version (see _prune_versions for the old ones)."""
    session.add(
        WhiteboardSnapshot(
            board_id=board.id,
            workspace_id=board.workspace_id,
            elements=board.elements,
            background=board.background,
            author_id=board.updated_by,
        )
    )
    board.snapshot_at = datetime.now(UTC)


async def _prune_versions(session: AsyncSession, board_id: uuid.UUID) -> None:
    keep = (
        select(WhiteboardSnapshot.id)
        .where(WhiteboardSnapshot.board_id == board_id)
        .order_by(WhiteboardSnapshot.id.desc())
        .limit(MAX_SNAPSHOTS)
    )
    await session.execute(
        delete(WhiteboardSnapshot).where(WhiteboardSnapshot.board_id == board_id, WhiteboardSnapshot.id.not_in(keep))
    )


async def _read_image(upload: UploadFile, limit: int, label: str) -> tuple[bytes, str, str]:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"{label} must be at most {limit // 1024} KB")
    detected = storage.sniff_image(data)
    if detected is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use PNG, JPG, GIF or WebP")
    return data, *detected


def _stored(stored: storage.StoredFile | None) -> Response:
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(
        stored.data,
        media_type=stored.content_type,
        headers={
            # Per user (it's behind a token), but the file itself never changes.
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


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
    out = await _created(session, ctx, board)
    await ctx.announce(f"criou o quadro “{board.name}”", group="board.created")
    return out


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


@router.delete("/channels/{channel_id}/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(channel_id: uuid.UUID, board_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """For good, with its versions. Only whoever created it, or who can manage addons here; the
    others archive. Images stay: they belong to the channel and duplicates may use them."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    board = await _board(session, ctx, board_id, lock=True)
    if board.created_by != user.id and not ctx.access.channel(ctx.channel) & Perm.MANAGE_ADDONS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only who created the board can delete it")
    thumbnail = board.thumbnail_key
    await session.delete(board)
    await session.commit()
    if thumbnail:
        await storage.delete(thumbnail)
    await ctx.publish("board.deleted", {"id": str(board_id)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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


# --- Scene ----------------------------------------------------------------------


@router.put("/channels/{channel_id}/boards/{board_id}/elements", response_model=SaveOut)
async def save_elements(
    channel_id: uuid.UUID, board_id: uuid.UUID, body: ElementsSave, user: CurrentUser, session: SessionDep
) -> SaveOut:
    """Saves the elements that changed (new, edited or deleted), merged one by one with what's
    saved: an older copy of an element never overwrites a newer one, so two people drawing at
    once don't lose each other's strokes. The accepted ones go live to whoever has the board
    open."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    for element in body.elements:
        if element.type not in ELEMENT_TYPES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unsupported element: {element.type}")
    board = await _board(session, ctx, board_id, lock=True)
    current: dict[str, dict[str, Any]] = board.elements
    accepted = [e for e in (e.model_dump(mode="json") for e in body.elements) if _wins(e, current.get(e["id"]))]
    if not accepted:
        return SaveOut(version=board.version, accepted=0)
    size = board.scene_bytes + sum(_size(e) - (_size(current[e["id"]]) if e["id"] in current else 0) for e in accepted)
    if size > MAX_SCENE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The board is full (5 MB)")
    now = datetime.now(UTC)
    if current and (board.snapshot_at is None or now - board.snapshot_at >= SNAPSHOT_EVERY):
        # The board as it was before this stretch of editing.
        _keep_version(session, board)
        await session.flush()
        await _prune_versions(session, board.id)
    board.elements = {**current, **{e["id"]: e for e in accepted}}
    board.scene_bytes = size
    board.version += 1
    board.updated_at, board.updated_by = now, user.id
    await session.commit()
    await ctx.publish_room(
        board.id, "elements", {"board_id": str(board.id), "version": board.version, "elements": accepted, "origin": body.origin}
    )
    await ctx.publish("board.updated", _summary(board).model_dump(mode="json"))
    return SaveOut(version=board.version, accepted=len(accepted))


# --- Images ---------------------------------------------------------------------


@router.post("/channels/{channel_id}/files", response_model=FileOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    channel_id: uuid.UUID,
    file_id: Annotated[str, Form(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")],
    file: Annotated[UploadFile, File(description="PNG, JPG, GIF or WebP, up to 10 MB")],
    user: CurrentUser,
    session: SessionDep,
) -> FileOut:
    """Stores an image placed on a board, under the id Excalidraw gave it (a hash of the
    content). Sending one the channel already has is a no-op."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    existing = await session.get(WhiteboardFile, (ctx.workspace_id, file_id))
    if existing is not None:
        return FileOut(file_id=file_id, content_type=existing.content_type)
    data, content_type, ext = await _read_image(file, MAX_IMAGE_BYTES, "Images")
    key = f"{workspace_prefix(ctx.workspace_id)}files/{uuid.uuid4().hex}.{ext}"
    await storage.put(key, data, content_type)
    session.add(
        WhiteboardFile(
            workspace_id=ctx.workspace_id,
            file_id=file_id,
            key=key,
            content_type=content_type,
            size=len(data),
            uploaded_by=user.id,
        )
    )
    try:
        await session.commit()
    except BaseException:
        await storage.delete(key)
        raise
    return FileOut(file_id=file_id, content_type=content_type)


@router.get("/channels/{channel_id}/files/{file_id}")
async def get_file(channel_id: uuid.UUID, file_id: str, user: CurrentUser, session: SessionDep) -> Response:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    row = await session.get(WhiteboardFile, (ctx.workspace_id, file_id))
    return _stored(await storage.get(row.key) if row else None)


@router.put("/channels/{channel_id}/boards/{board_id}/thumbnail", response_model=BoardSummary)
async def set_thumbnail(
    channel_id: uuid.UUID,
    board_id: uuid.UUID,
    file: Annotated[UploadFile, File(description="A small PNG or WebP of the scene")],
    user: CurrentUser,
    session: SessionDep,
) -> BoardSummary:
    """The app renders the picture for the list and the overview after editing."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    data, content_type, ext = await _read_image(file, MAX_THUMBNAIL_BYTES, "Thumbnails")
    board = await _board(session, ctx, board_id, lock=True)
    old = board.thumbnail_key
    board.thumbnail_key = f"{workspace_prefix(ctx.workspace_id)}thumbs/{secrets.token_hex(8)}.{ext}"
    await storage.put(board.thumbnail_key, data, content_type)
    try:
        await session.commit()
    except BaseException:
        await storage.delete(board.thumbnail_key)
        raise
    if old:
        await storage.delete(old)
    out = _summary(board)
    await ctx.publish("board.updated", out.model_dump(mode="json"))
    return out


@router.get("/channels/{channel_id}/boards/{board_id}/thumbnail")
async def get_thumbnail(channel_id: uuid.UUID, board_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    board = await _board(session, ctx, board_id)
    return _stored(await storage.get(board.thumbnail_key) if board.thumbnail_key else None)


# --- Versions -------------------------------------------------------------------


@router.get("/channels/{channel_id}/boards/{board_id}/versions", response_model=list[VersionOut])
async def list_versions(channel_id: uuid.UUID, board_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> list[VersionOut]:
    """Newest first."""
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    board = await _board(session, ctx, board_id)
    rows = await session.execute(
        select(WhiteboardSnapshot.id, WhiteboardSnapshot.author_id, WhiteboardSnapshot.created_at)
        .where(WhiteboardSnapshot.board_id == board.id)
        .order_by(WhiteboardSnapshot.id.desc())
    )
    return [VersionOut(id=i, author_id=a, created_at=c) for i, a, c in rows]


async def _version(session: AsyncSession, board: WhiteboardBoard, version_id: int) -> WhiteboardSnapshot:
    snapshot = await session.get(WhiteboardSnapshot, version_id)
    if snapshot is None or snapshot.board_id != board.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Version not found")
    return snapshot


@router.get("/channels/{channel_id}/boards/{board_id}/versions/{version_id}", response_model=VersionScene)
async def get_version(
    channel_id: uuid.UUID, board_id: uuid.UUID, version_id: int, user: CurrentUser, session: SessionDep
) -> VersionScene:
    """A version's drawing, to preview before restoring it."""
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    snapshot = await _version(session, await _board(session, ctx, board_id), version_id)
    return VersionScene(
        id=snapshot.id,
        author_id=snapshot.author_id,
        created_at=snapshot.created_at,
        elements=[e for e in snapshot.elements.values() if not e.get("isDeleted")],
    )


@router.post("/channels/{channel_id}/boards/{board_id}/versions/{version_id}/restore", response_model=BoardOut)
async def restore_version(
    channel_id: uuid.UUID, board_id: uuid.UUID, version_id: int, user: CurrentUser, session: SessionDep
) -> BoardOut:
    """Puts the board back as it was in that version. The board as it is now is kept as a
    version first, so restoring can be undone. Every element gets a version above the current
    one, so apps with the board open take the restored scene over their own."""
    ctx = await addon_channel(session, manifest, channel_id, user.id, "edit")
    board = await _board(session, ctx, board_id, lock=True)
    snapshot = await _version(session, board, version_id)
    current: dict[str, dict[str, Any]] = board.elements
    _keep_version(session, board)
    stamp = int(time.time() * 1000)

    def bumped(element: dict[str, Any], base: dict[str, Any] | None, **changes: Any) -> dict[str, Any]:
        version = max(element["version"], base["version"] if base else 0) + 1
        return {**element, **changes, "version": version, "versionNonce": secrets.randbelow(2**31), "updated": stamp}

    restored = {k: bumped(e, current.get(k)) for k, e in snapshot.elements.items()}
    # Drawn after that version: deleted, as tombstones like any other deletion.
    for k, e in current.items():
        if k not in restored and not e.get("isDeleted"):
            restored[k] = bumped(e, e, isDeleted=True)
    board.elements = restored
    board.background = snapshot.background
    board.scene_bytes = _scene_bytes(restored)
    board.version += 1
    board.updated_at, board.updated_by = datetime.now(UTC), user.id
    await session.flush()
    await _prune_versions(session, board.id)
    await session.commit()
    elements = list(restored.values())
    await ctx.publish_room(
        board.id, "elements", {"board_id": str(board.id), "version": board.version, "elements": elements, "origin": None}
    )
    summary = _summary(board)
    await ctx.publish("board.updated", summary.model_dump(mode="json"))
    return BoardOut(**summary.model_dump(), elements=elements, can_edit=True)


manifest = AddonManifest(
    key="whiteboard",
    name="Quadro branco",
    description="Desenho livre, formas, notas e imagens, juntos e ao vivo.",
    icon="presentation",
    router=router,
    permissions={"edit": Perm.EDIT_WHITEBOARD},
    on_cleanup=cleanup,
    announces=True,
    socket=live.HANDLERS,
    on_socket_close=live.closed,
)
