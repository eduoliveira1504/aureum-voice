import uuid
from urllib.parse import quote
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import account_invites, codes, images, mail, presence, ratelimit, storage
from app.access import audience_ids, get_channel_access
from app.deps import CurrentUser, SessionDep, SignedInUser
from app.mail.render import mask
from app.models import AccountInvite, AccountInviteUse, Attachment, AttachmentKind, EmailCodePurpose, User, UserSettings
from app.realtime import broker
from app.routers.auth import CODE_SENDS_PER_IP, CODE_TRIES_PER_IP, rejected, too_soon
from app.schemas import (
    ChangeEmail,
    CodeRequest,
    InviterOut,
    MyInvite,
    SettingsOut,
    SettingsUpdate,
    UserMe,
    UserPublic,
    UserUpdate,
)
from app.security import verify_password

router = APIRouter(prefix="/users", tags=["users"])

# Settings merged key by key (see SettingsUpdate), and how many keys each may hold.
MERGED_SETTINGS = {
    "panel_layouts": 200,  # one per server; stale ones (left servers) are cheap to keep
    "user_audio": 1000,
    "column_sizes": 30,
}
ImageKind = Literal["avatar", "banner"]
# Profile fields where null means "back to the default".
NOT_NULL_PROFILE: dict[str, Any] = {"avatar_frame": "none", "links": []}


async def _broadcast_profile(session: SessionDep, user: User) -> None:
    """Tells everyone who sees the user (servers, DMs, friends), so names/avatars update live."""
    data = UserPublic.model_validate(user).model_dump(mode="json")
    await broker.publish("user.updated", data, await audience_ids(session, user.id))


@router.get("/me", response_model=UserMe)
async def get_me(user: SignedInUser) -> User:
    # Also with a temporary password: the app reads must_change_password from here.
    return user


@router.patch("/me", response_model=UserMe)
async def update_me(body: UserUpdate, user: CurrentUser, session: SessionDep) -> User:
    for field, value in body.model_dump(mode="json", exclude_unset=True).items():
        if field == "display_name" and value is None:
            continue  # display_name is required; ignore explicit nulls
        if value is None and field in NOT_NULL_PROFILE:
            value = NOT_NULL_PROFILE[field]
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


# --- E-mail and invites (Configurações › Conta / Convites) ----------------------------


@router.post("/me/email", status_code=status.HTTP_202_ACCEPTED)
async def request_email_change(body: ChangeEmail, request: Request, user: CurrentUser, session: SessionDep) -> dict[str, bool]:
    """Sends a code to the new address; the account switches once it's typed (confirm below)."""
    await ratelimit.hit(f"code-send:{ratelimit.client_ip(request)}", *CODE_SENDS_PER_IP)
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Wrong password")
    if body.email == user.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="That is already your e-mail")
    if await session.scalar(select(User.id).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This email is already taken")
    try:
        code = await codes.issue(session, user.id, EmailCodePurpose.change_email, new_email=body.email)
    except codes.TooSoon as exc:
        raise too_soon(exc) from None
    mail.enqueue(session, body.email, "code_change_email", codigo=code, nome=user.display_name)
    await session.commit()
    return {"ok": True}


@router.post("/me/email/confirm", response_model=UserMe)
async def confirm_email_change(body: CodeRequest, request: Request, user: CurrentUser, session: SessionDep) -> User:
    """Switches to the new address; the old one gets a security notice."""
    await ratelimit.hit(f"code-try:{ratelimit.client_ip(request)}", *CODE_TRIES_PER_IP)
    try:
        row = await codes.consume(session, user.id, EmailCodePurpose.change_email, body.code)
    except codes.CodeRejected as exc:
        raise rejected(exc) from None
    assert row.new_email is not None
    old = user.email
    user.email = row.new_email
    # Typing the code proves the new address is theirs.
    user.email_verified_at = user.email_verified_at or row.sent_at
    mail.enqueue(
        session, old, "notice_email",
        nome=user.display_name, username=user.username, novo=mask(row.new_email), quando=mail.when(),
    )
    try:
        await session.commit()
    except IntegrityError:  # someone else took the address meanwhile
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This email is already taken")
    return user


@router.get("/me/invites", response_model=list[MyInvite])
async def my_invites(user: CurrentUser, session: SessionDep) -> list[MyInvite]:
    """The user's single-use account invites, with who used each."""
    invites = (
        await session.scalars(
            select(AccountInvite).where(AccountInvite.owner_id == user.id).order_by(AccountInvite.created_at, AccountInvite.code)
        )
    ).all()
    uses = {
        u.code: u
        for u in await session.scalars(select(AccountInviteUse).where(AccountInviteUse.code.in_([i.code for i in invites])))
    }
    out = []
    for invite in invites:
        use = uses.get(invite.code)
        state = "used" if invite.uses >= invite.max_uses else "pending" if use else "free"
        out.append(MyInvite(
            code=invite.code, url=account_invites.url(invite.code), status=state,
            used_by=InviterOut.model_validate(use.user) if use else None,
        ))
    return out


@router.get("/{user_id}", response_model=UserPublic)
async def get_user(user_id: uuid.UUID, _: CurrentUser, session: SessionDep) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


# --- Media --------------------------------------------------------------------

media_router = APIRouter(tags=["media"])


@media_router.get("/media/attachments/{attachment_id}")
async def get_attachment(attachment_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """A file sent in a conversation, for whoever can see that conversation (the app fetches it
    with its token). Not sent yet: only for its uploader. 404 otherwise, so ids can't be probed."""
    attachment = await session.get(Attachment, attachment_id)
    if attachment is None or (attachment.message_id is None and attachment.uploader_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await get_channel_access(session, attachment.channel_id, user.id)  # 404 if hidden
    stored = await storage.get(attachment.key)
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    disposition = "attachment" if attachment.kind == AttachmentKind.file else "inline"
    return Response(
        stored.data,
        media_type=attachment.content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(attachment.filename)}",
            # Per user (it's behind a token), but the file itself never changes.
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )


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
