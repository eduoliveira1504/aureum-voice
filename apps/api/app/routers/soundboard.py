import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status

from app import soundboard, storage
from app.access import server_member_ids
from app.deps import CurrentUser, SessionDep
from app.models import SoundboardSound
from app.permissions import Perm, server_access
from app.reactions import valid_emoji
from app.realtime import broker
from app.schemas import SoundName, SoundOut, SoundUpdate, SoundVolume

router = APIRouter(tags=["soundboard"])

SoundFile = Annotated[UploadFile, File(description="MP3, OGG or WAV, up to 5 s and 1 MB")]


def _emoji(value: str | None) -> str | None:
    if not value:
        return None
    if not valid_emoji(value):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Pick one emoji")
    return value


async def _changed(session: SessionDep, server_id: uuid.UUID) -> None:
    """The server's members reload its sounds."""
    await broker.publish("soundboard.updated", {"server_id": str(server_id)}, await server_member_ids(session, server_id))


@router.get("/servers/{server_id}/sounds", response_model=list[SoundOut])
async def list_sounds(server_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> list[SoundboardSound]:
    await server_access(session, server_id, user.id)
    return await soundboard.of_server(session, server_id)


@router.post("/servers/{server_id}/sounds", response_model=SoundOut, status_code=status.HTTP_201_CREATED)
async def add_sound(
    server_id: uuid.UUID,
    file: SoundFile,
    name: Annotated[SoundName, Form()],
    user: CurrentUser,
    session: SessionDep,
    emoji: Annotated[str | None, Form()] = None,
    volume: Annotated[SoundVolume, Form()] = 100,
) -> SoundboardSound:
    (await server_access(session, server_id, user.id)).require(Perm.MANAGE_SOUNDBOARD)
    data = await file.read(soundboard.MAX_BYTES + 1)
    sound = await soundboard.add(session, server_id, data, name, _emoji(emoji), volume, user.id)
    await session.commit()
    await session.refresh(sound)
    await _changed(session, server_id)
    return sound


async def _managed(session: SessionDep, sound_id: uuid.UUID, user_id: uuid.UUID) -> SoundboardSound:
    sound = await soundboard.visible(session, sound_id, user_id)
    (await server_access(session, sound.server_id, user_id)).require(Perm.MANAGE_SOUNDBOARD)
    return sound


@router.patch("/sounds/{sound_id}", response_model=SoundOut)
async def update_sound(sound_id: uuid.UUID, body: SoundUpdate, user: CurrentUser, session: SessionDep) -> SoundboardSound:
    sound = await _managed(session, sound_id, user.id)
    if body.name is not None:
        sound.name = body.name
    if body.emoji is not None:
        sound.emoji = _emoji(body.emoji)
    if body.volume is not None:
        sound.volume = body.volume
    await session.commit()
    await session.refresh(sound)
    await _changed(session, sound.server_id)
    return sound


@router.delete("/sounds/{sound_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sound(sound_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    sound = await _managed(session, sound_id, user.id)
    server_id, key = sound.server_id, sound.key
    await session.delete(sound)
    await session.commit()
    await storage.delete(key)
    await _changed(session, server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/media/sounds/{sound_id}")
async def sound_file(sound_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """The audio, for the server's members. 404 otherwise."""
    sound = await soundboard.visible(session, sound_id, user.id)
    stored = await storage.get(sound.key)
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(
        stored.data,
        media_type=sound.content_type,
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )
