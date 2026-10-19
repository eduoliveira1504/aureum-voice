from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app import account_invites, badges, codes, mail, onboarding, ratelimit
from app.accounts import is_reserved
from app.config import get_settings
from app.deps import CurrentUser, SessionDep, SignedInUser
from app.models import AccountInvite, AccountInviteUse, EmailCodePurpose, User
from app.realtime import broker
from app.schemas import (
    AuthConfig,
    ChangePassword,
    CodeRequest,
    Confirmation,
    EmailRequest,
    ForgotPassword,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPassword,
    TokenPair,
    UserMe,
    Username,
    UsernameCheck,
)
from app.security import create_token, decode_token, hash_password, needs_rehash, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# (attempts, window in seconds): generous for people, tight for scripts guessing passwords.
LOGIN_PER_IP = (10, 5 * 60)
FAILED_LOGINS_PER_ACCOUNT = (5, 15 * 60)
REGISTER_PER_IP = (5, 60 * 60)
USERNAME_CHECKS_PER_IP = (60, 60)
CODE_TRIES_PER_IP = (20, 10 * 60)  # on top of the 5 tries each code takes
CODE_SENDS_PER_IP = (10, 60 * 60)
FORGOT_PER_IP = (5, 15 * 60)
FORGOT_PER_EMAIL = (3, 60 * 60)

# Details the invite page and the app look for (they show their own pt-BR text).
INVITE_REQUIRED = "An invite code is required to sign up"
INVITE_INVALID = "Invalid invite code"
INVITE_DETAILS = {
    "used": "This invite was already used",
    "exhausted": "This invite has no spots left",
    "expired": "This invite has expired",
}
CODE_DETAILS = {
    "invalid": "Wrong code",
    "expired": "This code has expired; ask for a new one",
    "attempts": "Too many wrong tries; ask for a new code",
}


def token_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(user.id, "access", user.session_epoch),
        refresh_token=create_token(user.id, "refresh", user.session_epoch),
    )


def too_soon(exc: codes.TooSoon) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Wait a moment before asking for another code",
        headers={"Retry-After": str(exc.retry_after)},
    )


def rejected(exc: codes.CodeRejected) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail=CODE_DETAILS[exc.reason])


async def end_other_sessions(session: SessionDep, user: User) -> TokenPair:
    """Every token made so far stops working (other devices are signed out) and the caller gets
    fresh ones. Commits."""
    user.session_epoch += 1
    await session.commit()
    await broker.end_sessions(user.id, user.session_epoch)
    return token_pair(user)


# --- Sign-up ------------------------------------------------------------------


@router.get("/config", response_model=AuthConfig)
async def auth_config() -> AuthConfig:
    return AuthConfig(invite_only=get_settings().aureum_invite_only)


@router.get("/username-available", response_model=UsernameCheck)
async def username_available(request: Request, session: SessionDep, username: str = Query(max_length=64)) -> UsernameCheck:
    """For the sign-up forms, which check the @ while it's typed."""
    await ratelimit.hit(f"username-check:{ratelimit.client_ip(request)}", *USERNAME_CHECKS_PER_IP)
    try:
        name = TypeAdapter(Username).validate_python(username.lstrip("@"))
    except ValidationError:
        return UsernameCheck(available=False, reason="invalid")
    if is_reserved(name):
        return UsernameCheck(available=False, reason="reserved")
    if await session.scalar(select(User.id).where(User.username == name)):
        return UsernameCheck(available=False, reason="taken")
    return UsernameCheck(available=True)


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, request: Request, session: SessionDep) -> TokenPair:
    """While AUREUM_INVITE_ONLY=true, sign-up needs an account invite (server invites don't
    create accounts). The invite's use is only counted when the e-mail is confirmed. The new
    account gets a confirmation code by e-mail."""
    await ratelimit.hit(f"register:{ratelimit.client_ip(request)}", *REGISTER_PER_IP)

    # Invite first: without one, nobody can probe which usernames/e-mails exist.
    invite = None
    if get_settings().aureum_invite_only:
        if not body.invite_code:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=INVITE_REQUIRED)
        invite = await session.get(AccountInvite, account_invites.normalize(body.invite_code))
        if invite is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=INVITE_INVALID)
        if (state := account_invites.status(invite)) != "valid":
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail=INVITE_DETAILS[state])

    if is_reserved(body.username):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This username is reserved")
    existing = await session.scalar(
        select(User).where(or_(User.username == body.username, User.email == body.email))
    )
    if existing is not None:
        field = "username" if existing.username == body.username else "email"
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"This {field} is already taken")

    user = User(
        username=body.username,
        email=body.email,
        display_name=body.display_name or body.username,
        password_hash=hash_password(body.password),
        badge_grants=[],
    )
    session.add(user)
    try:
        await session.flush()
        await badges.grant_at_sign_up(session, user)
        if invite is not None:
            session.add(AccountInviteUse(user_id=user.id, code=invite.code))
        await onboarding.send_verification(session, user)
        await session.commit()
    except IntegrityError:  # lost a race with a concurrent registration
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Username or email already taken")
    return token_pair(user)


# --- E-mail confirmation ------------------------------------------------------


def _require_unconfirmed(user: User) -> None:
    if user.email_verified_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This e-mail is already confirmed")


@router.post("/verify-email", response_model=Confirmation)
async def verify_email(body: CodeRequest, request: Request, user: CurrentUser, session: SessionDep) -> Confirmation:
    await ratelimit.hit(f"code-try:{ratelimit.client_ip(request)}", *CODE_TRIES_PER_IP)
    _require_unconfirmed(user)
    try:
        await codes.consume(session, user.id, EmailCodePurpose.verify, body.code)
    except codes.CodeRejected as exc:
        raise rejected(exc) from None
    result = await onboarding.confirm(session, user)
    await session.commit()
    await onboarding.announce(session, user, result)
    await session.refresh(user)
    return Confirmation(
        user=UserMe.model_validate(user), pioneer_number=result.pioneer_number, invites=result.invites,
        joined_official=bool(result.joined),
    )


@router.post("/resend-code", status_code=status.HTTP_204_NO_CONTENT)
async def resend_code(request: Request, user: CurrentUser, session: SessionDep) -> Response:
    _require_unconfirmed(user)
    await ratelimit.hit(f"code-send:{ratelimit.client_ip(request)}", *CODE_SENDS_PER_IP)
    try:
        await onboarding.send_verification(session, user)
    except codes.TooSoon as exc:
        raise too_soon(exc) from None
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/pending-email", response_model=UserMe)
async def change_pending_email(body: EmailRequest, request: Request, user: CurrentUser, session: SessionDep) -> User:
    """Fixes a mistyped address before confirming it; the code goes to the new one."""
    _require_unconfirmed(user)
    await ratelimit.hit(f"code-send:{ratelimit.client_ip(request)}", *CODE_SENDS_PER_IP)
    if body.email != user.email:
        if await session.scalar(select(User.id).where(User.email == body.email)):
            raise HTTPException(status.HTTP_409_CONFLICT, detail="This email is already taken")
        user.email = body.email
    await onboarding.send_verification(session, user, wait=False)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This email is already taken")
    return user


# --- Login and tokens ---------------------------------------------------------


@router.post("/login", response_model=TokenPair)
async def login(body: LoginRequest, request: Request, session: SessionDep) -> TokenPair:
    failures = f"login-failed:{body.email}"
    await ratelimit.hit(f"login:{ratelimit.client_ip(request)}", *LOGIN_PER_IP)
    await ratelimit.check(failures, FAILED_LOGINS_PER_ACCOUNT[0])

    user = await session.scalar(select(User).where(User.email == body.email))
    if not verify_password(user.password_hash if user else None, body.password):
        await ratelimit.hit(failures, FAILED_LOGINS_PER_ACCOUNT[0] + 1, FAILED_LOGINS_PER_ACCOUNT[1])
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid e-mail or password")
    assert user is not None and user.password_hash is not None
    await ratelimit.reset(failures)

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        await session.commit()
    return token_pair(user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest, session: SessionDep) -> TokenPair:
    claims = decode_token(body.refresh_token, "refresh")
    user = await session.get(User, claims.user_id) if claims else None
    if user is None or claims is None or user.session_epoch != claims.epoch:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    return token_pair(user)


# --- Passwords ----------------------------------------------------------------


@router.post("/change-password", response_model=TokenPair)
async def change_password(body: ChangePassword, user: SignedInUser, session: SessionDep) -> TokenPair:
    """Also replaces a temporary password (then the current one isn't asked again). Ends the
    other sessions and returns new tokens for this one."""
    replacing_temporary = user.must_change_password
    if not replacing_temporary and not verify_password(user.password_hash, body.current_password or ""):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Wrong password")
    if verify_password(user.password_hash, body.new_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The new password must be different")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    if not replacing_temporary:
        mail.enqueue(session, user.email, "notice_password", nome=user.display_name, username=user.username, quando=mail.when())
    return await end_other_sessions(session, user)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(body: ForgotPassword, request: Request, session: SessionDep) -> dict[str, bool]:
    """Same answer whether or not the address has an account, so it reveals nothing."""
    await ratelimit.hit(f"forgot:{ratelimit.client_ip(request)}", *FORGOT_PER_IP)
    await ratelimit.hit(f"forgot-email:{body.email}", *FORGOT_PER_EMAIL)
    user = await session.scalar(select(User).where(User.email == body.email))
    if user is not None:
        try:
            code = await codes.issue(session, user.id, EmailCodePurpose.reset)
        except codes.TooSoon:
            pass  # one went out under a minute ago
        else:
            mail.enqueue(session, user.email, "code_reset", codigo=code, nome=user.display_name)
            await session.commit()
    return {"ok": True}


@router.post("/reset-password", response_model=TokenPair)
async def reset_password(body: ResetPassword, request: Request, session: SessionDep) -> TokenPair:
    """With the code from forgot-password: sets the new password, ends every session and signs
    this one in."""
    await ratelimit.hit(f"code-try:{ratelimit.client_ip(request)}", *CODE_TRIES_PER_IP)
    user = await session.scalar(select(User).where(User.email == body.email))
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=CODE_DETAILS["invalid"])
    try:
        await codes.consume(session, user.id, EmailCodePurpose.reset, body.code)
    except codes.CodeRejected as exc:
        raise rejected(exc) from None
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    mail.enqueue(session, user.email, "notice_password", nome=user.display_name, username=user.username, quando=mail.when())
    return await end_other_sessions(session, user)
