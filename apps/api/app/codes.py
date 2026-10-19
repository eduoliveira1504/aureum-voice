"""6-digit codes sent by e-mail: confirm the sign-up address, reset a forgotten password, confirm
a new address. Each lasts 15 minutes and takes 5 wrong tries; a new one can be asked for after
60 seconds, and it replaces the old one. Only an HMAC of the code is stored."""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import EmailCode, EmailCodePurpose

TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5
RESEND_AFTER = timedelta(seconds=60)


class TooSoon(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__(retry_after)
        self.retry_after = retry_after


class CodeRejected(Exception):
    """reason: "invalid" (wrong code, or none was sent), "expired" or "attempts" (too many tries)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _digest(user_id: uuid.UUID, purpose: EmailCodePurpose, code: str) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, f"{user_id}:{purpose.value}:{code}".encode(), hashlib.sha256).hexdigest()


def normalize(code: str) -> str:
    """People paste "482 913" or "482-913"."""
    return "".join(ch for ch in code if ch.isdigit())


async def issue(
    session: AsyncSession, user_id: uuid.UUID, purpose: EmailCodePurpose,
    *, new_email: str | None = None, wait: bool = True,
) -> str:
    """A fresh code (not committed). With wait, raises TooSoon if one was sent under 60s ago."""
    now = datetime.now(UTC)
    row = await session.get(EmailCode, (user_id, purpose))
    if row is not None and wait and now - row.sent_at < RESEND_AFTER:
        raise TooSoon(int((RESEND_AFTER - (now - row.sent_at)).total_seconds()) + 1)
    code = f"{secrets.randbelow(10**6):06d}"
    if row is None:
        row = EmailCode(user_id=user_id, purpose=purpose)
        session.add(row)
    row.code_hash = _digest(user_id, purpose, code)
    row.new_email = new_email
    row.expires_at = now + TTL
    row.attempts = 0
    row.sent_at = now
    return code


async def consume(session: AsyncSession, user_id: uuid.UUID, purpose: EmailCodePurpose, code: str) -> EmailCode:
    """Checks the code. A right one is deleted (not committed: it goes with the caller's change);
    a wrong try is counted and committed right away, then CodeRejected is raised."""
    row = await session.get(EmailCode, (user_id, purpose))
    if row is None:
        raise CodeRejected("invalid")
    if row.expires_at <= datetime.now(UTC):
        raise CodeRejected("expired")
    if row.attempts >= MAX_ATTEMPTS:
        raise CodeRejected("attempts")
    if not hmac.compare_digest(row.code_hash, _digest(user_id, purpose, normalize(code))):
        row.attempts += 1
        await session.commit()
        raise CodeRejected("attempts" if row.attempts >= MAX_ATTEMPTS else "invalid")
    await session.delete(row)
    return row
