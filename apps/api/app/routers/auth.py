from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.deps import SessionDep
from app.models import User
from app.schemas import LoginRequest, RefreshRequest, RegisterRequest, TokenPair
from app.security import (
    create_token,
    decode_token,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
    )


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, session: SessionDep) -> TokenPair:
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
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:  # lost a race with a concurrent registration
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Username or email already taken")
    return _token_pair(user)


@router.post("/login", response_model=TokenPair)
async def login(body: LoginRequest, session: SessionDep) -> TokenPair:
    user = await session.scalar(select(User).where(User.email == body.email))
    if not verify_password(user.password_hash if user else None, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid e-mail or password")
    assert user is not None and user.password_hash is not None

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
