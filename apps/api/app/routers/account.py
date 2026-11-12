"""Configurações › Conta › Desativar ou excluir conta (block 4.2.2, ADR 0049)."""

from fastapi import APIRouter, HTTPException, Response, status

from app import account_state, ratelimit
from app.deps import CurrentUser, SessionDep
from app.models import User
from app.schemas import PasswordConfirm
from app.security import verify_password

router = APIRouter(prefix="/users/me", tags=["account"])

# Password checks on these screens: 10 per 15 minutes per account.
PASSWORD_TRIES = (10, 15 * 60)


async def check_password(user: User, password: str) -> None:
    await ratelimit.hit(f"account-password:{user.id}", *PASSWORD_TRIES)
    if not verify_password(user.password_hash, password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Wrong password")


@router.post("/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate(body: PasswordConfirm, user: CurrentUser, session: SessionDep) -> Response:
    """Hides the account and signs it out everywhere; signing in again reactivates it."""
    await check_password(user, body.password)
    await account_state.deactivate(session, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
