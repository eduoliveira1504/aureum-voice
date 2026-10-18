import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status

from app import images, presence, storage
from app.access import audience_ids
from app.deps import CurrentUser, SessionDep
from app.models import User, UserSettings
from app.realtime import broker
from app.schemas import SettingsOut, SettingsUpdate, UserMe, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])

# Settings merged key by key (see SettingsUpdate), and how many keys each may hold.
MERGED_SETTINGS = {
    "panel_layouts": 200,  # one per server; stale ones (left servers) are cheap to keep
    "user_audio": 1000,
    "column_sizes": 30,
}
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
        if field in MERGED_SETTINGS:
            merged = {**(getattr(row, field) or {}), **value}
            value = {k: v for k, v in merged.items() if v is not None}
            if len(value) > MERGED_SETTINGS[field]:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Too many entries in {field}")
        setattr(row, field, value)
    await session.commit()
    await session.refresh(row)
    if body.status is not None:
        await presence.set_chosen(user.id, row.status)
        await presence.announce(user.id)
    # Other signed-in devices of the same user switch theme live.
    await broker.publish("settings.updated", SettingsOut.model_validate(row).model_dump(mode="json"), [user.id])
    return row


async def _set_image(kind: ImageKind, upload: UploadFile | None, user: User, session: SessionDep) -> User:
    """Replaces (or with no upload, removes) the user's avatar or banner."""
    new_url = await images.store_upload(upload, f"{kind}s/{user.id}") if upload else None
    field = f"{kind}_url"
    old_url = getattr(user, field)
    setattr(user, field, new_url)
    await images.replace(old_url, new_url, session.commit)
    await _broadcast_profile(session, user)
    return user


ImageUpload = Annotated[UploadFile, File(description="PNG, JPG, GIF or WebP (animated allowed), up to 8 MB")]


@router.post("/me/avatar", response_model=UserMe)
async def upload_avatar(file: ImageUpload, user: CurrentUser, session: SessionDep) -> User:
    return await _set_image("avatar", file, user, session)


@router.post("/me/banner", response_model=UserMe)
async def upload_banner(file: ImageUpload, user: CurrentUser, session: SessionDep) -> User:
    return await _set_image("banner", file, user, session)


@router.delete("/me/avatar", response_model=UserMe)
async def remove_avatar(user: CurrentUser, session: SessionDep) -> User:
    return await _set_image("avatar", None, user, session)


@router.delete("/me/banner", response_model=UserMe)
async def remove_banner(user: CurrentUser, session: SessionDep) -> User:
    return await _set_image("banner", None, user, session)


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
    if not key.startswith(images.PUBLIC_PREFIXES) or ".." in key:
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
