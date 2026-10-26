import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select

from app import stickers, storage
from app.access import server_member_ids
from app.deps import CurrentUser, SessionDep
from app.models import Sticker
from app.permissions import Perm, server_access
from app.reactions import valid_emoji
from app.realtime import broker
from app.schemas import StickerName, StickerOut, StickerPackOut, StickerUpdate

router = APIRouter(tags=["stickers"])

StickerFile = Annotated[UploadFile, File(description="PNG or WebP, static, up to 512 KB")]


def _emoji(value: str | None) -> str | None:
    if not value:
        return None
    if not valid_emoji(value):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Pick one emoji")
    return value


async def _changed(session: SessionDep, server_id: uuid.UUID) -> None:
    """The server's members reload its stickers."""
    await broker.publish("stickers.updated", {"server_id": str(server_id)}, await server_member_ids(session, server_id))


@router.get("/stickers", response_model=list[StickerPackOut])
async def list_stickers(user: CurrentUser, session: SessionDep) -> list:
    """Aureum's packs, then the user's servers' own stickers."""
    return await stickers.visible_packs(session, user.id)


@router.post("/servers/{server_id}/stickers", response_model=StickerOut, status_code=status.HTTP_201_CREATED)
async def add_sticker(
    server_id: uuid.UUID,
    file: StickerFile,
    name: Annotated[StickerName, Form()],
    user: CurrentUser,
    session: SessionDep,
    emoji: Annotated[str | None, Form()] = None,
) -> Sticker:
    access = await server_access(session, server_id, user.id)
    access.require(Perm.MANAGE_EXPRESSIONS)
    pack = await stickers.server_pack(session, server_id, create=True)
    assert pack is not None
    count = await session.scalar(select(func.count()).select_from(Sticker).where(Sticker.pack_id == pack.id))
    if (count or 0) >= stickers.MAX_PER_SERVER:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A server can have up to {stickers.MAX_PER_SERVER} stickers")
    sticker = await stickers.add(session, pack, await file.read(stickers.MAX_BYTES + 1), name, _emoji(emoji), user.id)
    await session.commit()
    await session.refresh(sticker)
    await _changed(session, server_id)
    return sticker


async def _managed(session: SessionDep, sticker_id: uuid.UUID, user_id: uuid.UUID) -> Sticker:
    """A server's sticker that the user may change (MANAGE_EXPRESSIONS). Aureum's are CLI only."""
    sticker = await session.get(Sticker, sticker_id)
    if sticker is None or not await stickers.can_see(session, sticker, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sticker not found")
    if sticker.pack.server_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Aureum's stickers can't be changed")
    (await server_access(session, sticker.pack.server_id, user_id)).require(Perm.MANAGE_EXPRESSIONS)
    return sticker


@router.patch("/stickers/{sticker_id}", response_model=StickerOut)
async def update_sticker(sticker_id: uuid.UUID, body: StickerUpdate, user: CurrentUser, session: SessionDep) -> Sticker:
    sticker = await _managed(session, sticker_id, user.id)
    if body.name is not None:
        sticker.name = body.name
    if body.emoji is not None:
        sticker.emoji = _emoji(body.emoji)
    server_id = sticker.pack.server_id
    await session.commit()
    await session.refresh(sticker)
    assert server_id is not None
    await _changed(session, server_id)
    return sticker


@router.delete("/stickers/{sticker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sticker(sticker_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Messages that sent it keep its name and show it's gone."""
    sticker = await _managed(session, sticker_id, user.id)
    server_id, key = sticker.pack.server_id, sticker.key
    await session.delete(sticker)
    await session.commit()
    await storage.delete(key)
    assert server_id is not None
    await _changed(session, server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/media/stickers/{sticker_id}")
async def sticker_file(sticker_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """The image, for whoever may see it (anyone for Aureum's, members for a server's). 404 otherwise."""
    sticker = await session.get(Sticker, sticker_id)
    if sticker is None or not await stickers.can_see(session, sticker, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    stored = await storage.get(sticker.key)
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(
        stored.data,
        media_type="image/webp",
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )
