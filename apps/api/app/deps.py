from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import User
from app.security import decode_token

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_bearer = HTTPBearer(auto_error=False)
PASSWORD_CHANGE_REQUIRED = "Password change required"


async def get_signed_in_user(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """The token's user, even one who still has to replace a temporary password. Only the
    routes that screen needs use this directly (see SignedInUser)."""
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    claims = decode_token(credentials.credentials, "access")
    if claims is None:
        raise unauthorized
    user = await session.get(User, claims.user_id)
    if user is None or user.session_epoch != claims.epoch:  # sessions ended by a password change
        raise unauthorized
    return user


SignedInUser = Annotated[User, Depends(get_signed_in_user)]


async def get_current_user(user: SignedInUser) -> User:
    if user.must_change_password:
        # The app shows the "choose a new password" screen on this exact detail.
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=PASSWORD_CHANGE_REQUIRED)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
