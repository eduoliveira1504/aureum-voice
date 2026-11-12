"""Deleting an account (block 4.2.2, ADR 0049).

Asking for it (password + a code sent by e-mail) deactivates the account and schedules the
deletion for 30 days later; signing in during that time offers "Cancelar exclusão". Owners of a
server must hand it over first. A worker in the API process finishes the deletions that are due;
`python -m app.cli accounts purge` uses the same `finalize` for fake accounts.

What `finalize` deletes and what stays is listed in docs/decisions/0049-account-deletion.md. In
short: the user row goes, and the database cascades take friendships, requests, sessions,
memberships, invites, settings, badges, votes and reactions with it. Avatar and banner files go.
Messages stay with no author ("Usuário excluído") unless the user asked to delete them too, and
the Pioneer number stays taken. The @ is held for a while as an HMAC (ReleasedUsername).
"""

import asyncio
import hashlib
import hmac
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import account_state, attachments, images, mail, storage
from app.config import get_settings
from app.db import SessionLocal
from app.models import Attachment, Message, ReleasedUsername, Server, User

log = logging.getLogger(__name__)

GRACE = timedelta(days=30)
USERNAME_HOLD = timedelta(days=90)
# The worker looks for due deletions this often (cheap: one indexed query).
CHECK_EVERY_SECONDS = 60 * 60
BATCH = 20


async def owned_servers(session: AsyncSession, user_id: uuid.UUID) -> list[Server]:
    return list(await session.scalars(select(Server).where(Server.owner_id == user_id).order_by(Server.name)))


def username_hash(username: str) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, f"released-username:{username.strip().lower()}".encode(), hashlib.sha256).hexdigest()


async def username_held(session: AsyncSession, username: str) -> bool:
    """Whether this @ belonged to an account deleted less than USERNAME_HOLD ago."""
    held_until = await session.scalar(
        select(ReleasedUsername.held_until).where(ReleasedUsername.username_hash == username_hash(username))
    )
    return held_until is not None and held_until > datetime.now(UTC)


def _date(moment: datetime) -> str:
    return mail.when(moment).split(" às ")[0]


async def schedule(session: AsyncSession, user: User, *, delete_messages: bool) -> datetime:
    """The caller checked the password, the code and that the user owns no server. Commits."""
    now = datetime.now(UTC)
    user.deletion_due_at = now + GRACE
    user.delete_messages = delete_messages
    mail.enqueue(
        session, user.email, "notice_deletion_scheduled",
        nome=user.display_name, username=user.username, quando=mail.when(now), prazo=_date(user.deletion_due_at),
    )
    await account_state.deactivate(session, user)
    return user.deletion_due_at


async def cancel(session: AsyncSession, user: User) -> None:
    """Commits. The account is active again, as before."""
    await account_state.reactivate(session, user)


async def finalize(session: AsyncSession, user: User, *, notify: bool = True) -> bool:
    """Deletes the account now. Returns False (and changes nothing) while it owns a server.
    Commits, then deletes the stored files."""
    if await owned_servers(session, user.id):
        log.warning("Account %s is due for deletion but still owns a server; skipped", user.id)
        return False
    image_keys = images.stored_keys(user.avatar_url, user.avatar_source) | images.stored_keys(
        user.banner_url, user.banner_source
    )
    # Files uploaded but never sent: only the uploader ever saw them.
    file_keys = list(
        await session.scalars(
            delete(Attachment)
            .where(Attachment.uploader_id == user.id, Attachment.message_id.is_(None))
            .returning(Attachment.key)
        )
    )
    if user.delete_messages:
        message_ids = list(await session.scalars(select(Message.id).where(Message.author_id == user.id)))
        file_keys += await attachments.keys_of_messages(session, message_ids)
        # Attachments, reactions and polls of these messages go with them (cascades).
        await session.execute(delete(Message).where(Message.author_id == user.id))
    held_until = datetime.now(UTC) + USERNAME_HOLD
    await session.execute(
        insert(ReleasedUsername)
        .values(username_hash=username_hash(user.username), held_until=held_until)
        .on_conflict_do_update(index_elements=["username_hash"], set_={"held_until": held_until})
    )
    if notify:
        mail.enqueue(
            session, user.email, "notice_deleted", nome=user.display_name, username=user.username, quando=mail.when()
        )
    user_id = user.id
    session.expunge(user)
    await session.execute(delete(User).where(User.id == user_id))
    await session.commit()
    await attachments.delete_keys(session, file_keys)
    for key in image_keys:
        await storage.delete(key)
    log.info("Account %s deleted", user_id)
    return True


async def finish_due(now: datetime | None = None) -> int:
    """Finishes the deletions that are due. Returns how many accounts were deleted."""
    now = now or datetime.now(UTC)
    async with SessionLocal() as session:
        # Owners can't get here (asking checks it, and nobody can hand a server to a deactivated
        # account); they're left out anyway so they never hold up the others.
        ids = list(
            await session.scalars(
                select(User.id)
                .where(User.deletion_due_at <= now, ~select(Server.id).where(Server.owner_id == User.id).exists())
                .order_by(User.deletion_due_at)
                .limit(BATCH)
            )
        )
    done = 0
    for user_id in ids:
        async with SessionLocal() as session:
            user = await session.scalar(select(User).where(User.id == user_id).with_for_update(skip_locked=True))
            # Cancelled or taken by another process in the meantime.
            if user is None or user.deletion_due_at is None or user.deletion_due_at > now:
                continue
            done += await finalize(session, user)
    return done


async def run_worker() -> None:
    """Runs for the life of the API process."""
    while True:
        try:
            while await finish_due() == BATCH:
                pass
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Account deletion worker failed; trying again later")
        await asyncio.sleep(CHECK_EVERY_SECONDS)
