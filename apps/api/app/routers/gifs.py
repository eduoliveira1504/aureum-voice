import uuid
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import gifs
from app.config import get_settings
from app.deps import CurrentUser, SessionDep
from app.models import GifFavorite
from app.realtime import broker
from app.schemas import GifConfigOut, GifIn

router = APIRouter(prefix="/gifs", tags=["gifs"])

GifId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$")]


@router.get("/config", response_model=GifConfigOut)
async def gif_config(user: CurrentUser) -> GifConfigOut:
    """How the app searches Klipy itself. Without a key in .env, GIFs are off (no button)."""
    on = gifs.enabled()
    return GifConfigOut(
        enabled=on,
        provider=gifs.PROVIDER,
        app_key=get_settings().klipy_app_key if on else None,
        customer_id=gifs.customer_id(user.id) if on else None,
        content_filter=gifs.CONTENT_FILTER,
        locale=gifs.LOCALE,
    )


async def _favorites(session: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await session.scalars(
        select(GifFavorite).where(GifFavorite.user_id == user_id).order_by(GifFavorite.created_at.desc())
    )
    return [row.data for row in rows]


@router.get("/favorites")
async def list_favorites(user: CurrentUser, session: SessionDep) -> list[dict[str, Any]]:
    """Newest first."""
    return await _favorites(session, user.id)


async def _changed(session: AsyncSession, user_id: uuid.UUID) -> None:
    """The user's other devices update their stars."""
    await broker.publish("gifs.favorites", {"favorites": await _favorites(session, user_id)}, [user_id])


@router.put("/favorites/{gif_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_favorite(gif_id: GifId, body: GifIn, user: CurrentUser, session: SessionDep) -> Response:
    if body.id != gif_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The GIF doesn't match the path")
    count = await session.scalar(select(func.count()).select_from(GifFavorite).where(GifFavorite.user_id == user.id))
    exists = await session.get(GifFavorite, (user.id, gifs.PROVIDER, gif_id))
    if exists is None and (count or 0) >= gifs.MAX_FAVORITES:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Up to {gifs.MAX_FAVORITES} favorite GIFs")
    await session.execute(
        insert(GifFavorite)
        .values(user_id=user.id, provider=gifs.PROVIDER, gif_id=gif_id, data=gifs.snapshot(body))
        .on_conflict_do_nothing()
    )
    await session.commit()
    await _changed(session, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/favorites/{gif_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite(gif_id: GifId, user: CurrentUser, session: SessionDep) -> Response:
    await session.execute(
        delete(GifFavorite).where(
            GifFavorite.user_id == user.id, GifFavorite.provider == gifs.PROVIDER, GifFavorite.gif_id == gif_id
        )
    )
    await session.commit()
    await _changed(session, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
