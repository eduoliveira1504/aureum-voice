"""Account invites: what signing up needs while AUREUM_INVITE_ONLY=true (server invites only
bring existing accounts into a server). Single-use ones are handed to every confirmed user;
group ones, with several spots and an expiry, come from the CLI. A use counts when the invited
person confirms their e-mail, so a sign-up that never confirms doesn't spend a spot; and
whoever signed up while there was a spot can still confirm after it runs out."""

import re
import secrets
import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import AccountInvite, AccountInviteKind

PER_USER = 3  # single-use invites each confirmed (non-official) account gets
# No 0/O or 1/I/L: codes get read aloud and typed from a phone.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8

Status = Literal["valid", "used", "exhausted", "expired"]


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def normalize(raw: str) -> str:
    """Accepts the code or the whole link (…/convite/AB12CD34), any case."""
    raw = raw.strip().rstrip("/")
    raw = raw.rsplit("/", 1)[-1]
    return re.sub(r"[^A-Za-z0-9]", "", raw).upper()[:16]


def url(code: str) -> str:
    return f"{get_settings().public_url}/convite/{code}"


def status(invite: AccountInvite, now: datetime | None = None) -> Status:
    if invite.expires_at is not None and invite.expires_at <= (now or datetime.now(UTC)):
        return "expired"
    if invite.uses >= invite.max_uses:
        return "used" if invite.kind == AccountInviteKind.single else "exhausted"
    return "valid"


def create(
    session: AsyncSession, *, owner_id: uuid.UUID | None = None, max_uses: int = 1,
    expires_at: datetime | None = None,
) -> AccountInvite:
    """A new invite (not committed). One use makes it single; more make it a group invite."""
    invite = AccountInvite(
        code=new_code(),
        kind=AccountInviteKind.single if max_uses == 1 else AccountInviteKind.group,
        owner_id=owner_id, max_uses=max_uses, uses=0, expires_at=expires_at,
    )
    session.add(invite)
    return invite
