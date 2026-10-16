import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status

from app import storage
from app.access import audience_ids
from app.deps import CurrentUser, SessionDep
from app.models import User, UserSettings
from app.realtime import broker
from app.schemas import SettingsOut, SettingsUpdate, UserMe, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PANEL_LAYOUTS = 200  # one per server; stale ones (left servers) are cheap to keep
ImageKind = Literal["avatar", "banner"]


async def _broadcast_profile(session: SessionDep, user: User) -> None:
    """Tells everyone who sees the user (servers, DMs, friends), so names/avatars update live."""
    data = UserPublic.model_validate(user).model_dump(mode="json")
    await broker.publish("user.updated", data, await audience_ids(session, user.id))


@router.get("/me", response_model=UserMe)
async def get_me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserMe)
async def update_me(body: UserUpdate, user: CurrentUser, session: SessionDep) -> User:
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "display_name" and value is None:
            continue  # display_name is required; ignore explicit nulls
        setattr(user, field, value)
    await session.commit()
    await _broadcast_profile(session, user)
    return user


@router.get("/me/settings", response_model=SettingsOut)
async def get_my_settings(user: CurrentUser, session: SessionDep) -> UserSettings | SettingsOut:
    return await session.get(UserSettings, user.id) or SettingsOut()


@router.patch("/me/settings", response_model=SettingsOut)
async def update_my_settings(body: SettingsUpdate, user: CurrentUser, session: SessionDep) -> UserSettings:
    row = await session.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id)
        session.add(row)
    for field, value in body.model_dump(mode="json", exclude_unset=True).items():
        if value is None:  # every setting has a value; an explicit null means "unchanged"
            continue
        if field == "panel_layouts":
            merged = {**(row.panel_layouts or {}), **value}
            value = {k: v for k, v in merged.items() if v is not None}
            if len(value) > MAX_PANEL_LAYOUTS:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Too many panel layouts")
        setattr(row, field, value)
    await session.commit()
    await session.refresh(row)
    # Other signed-in devices of the same user switch theme live.
    await broker.publish("settings.updated", SettingsOut.model_validate(row).model_dump(mode="json"), [user.id])
    return row


async def _read_limited(upload: UploadFile) -> bytes:
    data = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image must be at most 8 MB")
    return data


async def _replace_image(kind: ImageKind, upload: UploadFile, user: User, session: SessionDep) -> User:
    data = await _read_limited(upload)
    detected = storage.sniff_image(data)
    if detected is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use PNG, JPG, GIF or WebP")
    content_type, ext = detected

    key = f"{kind}s/{user.id}/{uuid.uuid4().hex}.{ext}"
    await storage.put(key, data, content_type)
    field = f"{kind}_url"
    old_key = storage.key_from_url(getattr(user, field))
    setattr(user, field, storage.url_for(key))
    await session.commit()
    if old_key:
        await storage.delete(old_key)
    await _broadcast_profile(session, user)
    return user


async def _remove_image(kind: ImageKind, user: User, session: SessionDep) -> User:
    field = f"{kind}_url"
    old_key = storage.key_from_url(getattr(user, field))
    setattr(user, field, None)
    await session.commit()
    if old_key:
        await storage.delete(old_key)
    await _broadcast_profile(session, user)
    return user


ImageUpload = Annotated[UploadFile, File(description="PNG, JPG, GIF or WebP (animated allowed), up to 8 MB")]


@router.post("/me/avatar", response_model=UserMe)
async def upload_avatar(file: ImageUpload, user: CurrentUser, session: SessionDep) -> User:
    return await _replace_image("avatar", file, user, session)


@router.post("/me/banner", response_model=UserMe)
async def upload_banner(file: ImageUpload, user: CurrentUser, session: SessionDep) -> User:
    return await _replace_image("banner", file, user, session)


@router.delete("/me/avatar", response_model=UserMe)
async def remove_avatar(user: CurrentUser, session: SessionDep) -> User:
    return await _remove_image("avatar", user, session)


@router.delete("/me/banner", response_model=UserMe)
async def remove_banner(user: CurrentUser, session: SessionDep) -> User:
    return await _remove_image("banner", user, session)


@router.get("/{user_id}", response_model=UserPublic)
async def get_user(user_id: uuid.UUID, _: CurrentUser, session: SessionDep) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


# --- Media --------------------------------------------------------------------

media_router = APIRouter(tags=["media"])


@media_router.get("/media/{key:path}")
async def get_media(key: str) -> Response:
    """Serves stored files. Public on purpose: <img> tags can't send auth headers, and keys
    contain a random id, so they can't be guessed."""
    if not key.startswith(("avatars/", "banners/")) or ".." in key:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    stored = await storage.get(key)
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(
        stored.data,
        media_type=stored.content_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )
