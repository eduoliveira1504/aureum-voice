from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app import badges, ratelimit
from app.deps import SessionDep
from app.models import ServerMember, User
from app.routers.servers import announce_member_joined, claim_invite
from app.schemas import LoginRequest, RefreshRequest, RegisterRequest, TokenPair
from app.security import (
    create_token,
    decode_token,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# (attempts, window in seconds): generous for people, tight for scripts guessing passwords.
LOGIN_PER_IP = (10, 5 * 60)
FAILED_LOGINS_PER_ACCOUNT = (5, 15 * 60)
REGISTER_PER_IP = (5, 60 * 60)


def _token_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
    )


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, request: Request, session: SessionDep) -> TokenPair:
    """Sign-up requires an invite code, which also puts the new user in that server. The only
    exception is the very first account of a fresh install (no users yet)."""
    await ratelimit.hit(f"register:{ratelimit.client_ip(request)}", *REGISTER_PER_IP)

    # Invite first: without one, nobody can probe which usernames/e-mails exist. The claimed
    # use is only committed together with the new account, so later errors don't spend it.
    server_id = None
    if await session.scalar(select(func.count()).select_from(User)):
        if not body.invite_code:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="An invite code is required to sign up")
        server_id = await claim_invite(session, body.invite_code)
        if server_id is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Invalid, expired or used-up invite code")

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
    member = None
    try:
        await session.flush()
        await badges.grant_at_sign_up(session, user)
        if server_id is not None:
            member = ServerMember(server_id=server_id, user_id=user.id)
            session.add(member)
        await session.commit()  # invite use, account and membership: all or nothing
    except IntegrityError:  # lost a race with a concurrent registration
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Username or email already taken")
    if member is not None:
        await announce_member_joined(session, member)
    return _token_pair(user)


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
    return _token_pair(user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest, session: SessionDep) -> TokenPair:
    user_id = decode_token(body.refresh_token, "refresh")
    user = await session.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    return _token_pair(user)
