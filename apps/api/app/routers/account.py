"""Configurações › Conta › Desativar ou excluir conta (block 4.2.2, ADR 0049)."""

from fastapi import APIRouter, HTTPException, Request, Response, status

from app import account_deletion, account_state, codes, mail, ratelimit
from app.deps import CurrentUser, SessionDep, SignedInUser
from app.models import EmailCodePurpose, User
from app.routers.auth import CODE_SENDS_PER_IP, CODE_TRIES_PER_IP, rejected, too_soon
from app.schemas import DeletionOut, DeletionRequest, PasswordConfirm
from app.security import verify_password

router = APIRouter(prefix="/users/me", tags=["account"])

# Password checks on these screens: 10 per 15 minutes per account.
PASSWORD_TRIES = (10, 15 * 60)
OWNS_SERVERS = "owns_servers"


async def check_password(user: User, password: str) -> None:
    await ratelimit.hit(f"account-password:{user.id}", *PASSWORD_TRIES)
    if not verify_password(user.password_hash, password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Wrong password")


async def _require_no_servers(session: SessionDep, user: User) -> None:
    """Owners hand their servers over (or delete them) first; 409 with the list otherwise."""
    if owned := await account_deletion.owned_servers(session, user.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": OWNS_SERVERS,
                "message": "Transfer or delete the servers you own first",
                "servers": [{"id": str(s.id), "name": s.name} for s in owned],
            },
        )


@router.post("/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate(body: PasswordConfirm, user: CurrentUser, session: SessionDep) -> Response:
    """Hides the account and signs it out everywhere; signing in again reactivates it."""
    await check_password(user, body.password)
    await account_state.deactivate(session, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/deletion/code", status_code=status.HTTP_202_ACCEPTED)
async def send_deletion_code(body: PasswordConfirm, request: Request, user: CurrentUser, session: SessionDep) -> dict[str, bool]:
    """Step 1: the password, then a 6-digit code to the account's e-mail."""
    await ratelimit.hit(f"code-send:{ratelimit.client_ip(request)}", *CODE_SENDS_PER_IP)
    await check_password(user, body.password)
    await _require_no_servers(session, user)
    try:
        code = await codes.issue(session, user.id, EmailCodePurpose.delete_account)
    except codes.TooSoon as exc:
        raise too_soon(exc) from None
    mail.enqueue(session, user.email, "code_delete_account", codigo=code, nome=user.display_name)
    await session.commit()
    return {"ok": True}


@router.post("/deletion", response_model=DeletionOut)
async def schedule_deletion(body: DeletionRequest, request: Request, user: CurrentUser, session: SessionDep) -> DeletionOut:
    """Step 2: password and code again. The account is deactivated now and deleted in 30 days."""
    await ratelimit.hit(f"code-try:{ratelimit.client_ip(request)}", *CODE_TRIES_PER_IP)
    await check_password(user, body.password)
    await _require_no_servers(session, user)
    try:
        await codes.consume(session, user.id, EmailCodePurpose.delete_account, body.code)
    except codes.CodeRejected as exc:
        raise rejected(exc) from None
    due = await account_deletion.schedule(session, user, delete_messages=body.delete_messages)
    return DeletionOut(deletion_due_at=due)


@router.delete("/deletion", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_deletion(user: SignedInUser, session: SessionDep) -> Response:
    """"Cancelar exclusão", after signing in during the 30 days: everything comes back."""
    if user.deletion_due_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No deletion scheduled")
    await account_deletion.cancel(session, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
