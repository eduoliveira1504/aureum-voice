"""Friends: requests by @username, accept/decline/cancel, unfriend, block and unblock.

Each side sees the same row differently (the requester's "outgoing" is the addressee's
"incoming"), so events are built per recipient. Someone who blocked you just disappears from
your lists: blocks are never shown to the blocked person.
"""

import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import presence, ratelimit, social
from app.deps import CurrentUser, SessionDep
from app.models import Friendship, FriendshipStatus, User
from app.realtime import broker
from app.schemas import FriendKind, FriendOut, FriendRequest, UserPublic

router = APIRouter(prefix="/friends", tags=["friends"])

# Generous for people, tight for scripts walking the user list.
REQUESTS_PER_USER = (30, 60 * 60)


def _kind(row: Friendship, viewer: uuid.UUID) -> FriendKind:
    if row.status == FriendshipStatus.accepted:
        return "friend"
    if row.status == FriendshipStatus.blocked:
        return "blocked"
    return "outgoing" if row.requester_id == viewer else "incoming"


async def _out(session: AsyncSession, row: Friendship, viewer: uuid.UUID) -> FriendOut:
    other_id = row.addressee_id if row.requester_id == viewer else row.requester_id
    other = await session.get(User, other_id)
    assert other is not None
    # Only friends see each other's status.
    status_ = (await presence.statuses([other_id]))[other_id] if row.status == FriendshipStatus.accepted else "offline"
    return FriendOut(user=UserPublic.model_validate(other), kind=_kind(row, viewer), since=row.created_at, status=status_)


async def _announce(session: AsyncSession, row: Friendship) -> None:
    """Sends each side its own view of the row (a block only to the blocker)."""
    viewers = [row.requester_id] if row.status == FriendshipStatus.blocked else [row.requester_id, row.addressee_id]
    for viewer in viewers:
        out = await _out(session, row, viewer)
        await broker.publish("friend.updated", out.model_dump(mode="json"), [viewer])


async def _announce_removed(viewer: uuid.UUID, other: uuid.UUID) -> None:
    await broker.publish("friend.removed", {"user_id": str(other)}, [viewer])


async def _other_user(session: AsyncSession, me: uuid.UUID, user_id: uuid.UUID) -> User:
    if user_id == me:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="That's you")
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.get("", response_model=list[FriendOut])
async def list_friends(user: CurrentUser, session: SessionDep) -> list[FriendOut]:
    rows = await session.scalars(
        select(Friendship).where(
            or_(
                Friendship.requester_id == user.id,
                # Blocks of me by others stay invisible.
                (Friendship.addressee_id == user.id) & (Friendship.status != FriendshipStatus.blocked),
            )
        )
    )
    rows = list(rows)
    others = [r.addressee_id if r.requester_id == user.id else r.requester_id for r in rows]
    users = {u.id: u for u in await session.scalars(select(User).where(User.id.in_(others)))}
    statuses = await presence.statuses(others)
    out = []
    for row, other in zip(rows, others, strict=True):
        kind = _kind(row, user.id)
        out.append(
            FriendOut(
                user=UserPublic.model_validate(users[other]),
                kind=kind,
                since=row.created_at,
                status=statuses[other] if kind == "friend" else "offline",
            )
        )
    return sorted(out, key=lambda f: f.user.display_name.lower())


@router.post("/requests", response_model=FriendOut, status_code=status.HTTP_201_CREATED)
async def send_request(body: FriendRequest, user: CurrentUser, session: SessionDep, response: Response) -> FriendOut:
    """Sends a request by @username. If they already asked us, this accepts it instead."""
    await ratelimit.hit(f"friend-request:{user.id}", *REQUESTS_PER_USER)
    username = body.username.removeprefix("@").lower()
    other = await session.scalar(select(User).where(User.username == username))
    if other is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No user with that username")
    if other.id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="You can't add yourself")
    if other.is_official and other.is_bot:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="A conta oficial do Aureum não aceita pedidos de amizade.")

    rows = await social.pair_rows(session, user.id, other.id)
    if any(r.status == FriendshipStatus.blocked and r.requester_id == user.id for r in rows):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Unblock this user first")
    if any(r.status == FriendshipStatus.blocked for r in rows):
        # Vague on purpose: it doesn't say who blocked whom.
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can't send a request to this user")

    row = next((r for r in rows if r.status != FriendshipStatus.blocked), None)
    if row is not None and row.status == FriendshipStatus.accepted:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You're already friends")
    if row is not None and row.requester_id == user.id:
        response.status_code = status.HTTP_200_OK  # already sent: idempotent
        return await _out(session, row, user.id)
    if row is not None:  # they asked first: accept
        row.status = FriendshipStatus.accepted
    else:
        row = Friendship(requester_id=user.id, addressee_id=other.id, status=FriendshipStatus.pending)
        session.add(row)
    try:
        await session.commit()
    except IntegrityError:  # a crossed request landed at the same moment
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Try again") from None
    await session.refresh(row)
    await _announce(session, row)
    return await _out(session, row, user.id)


@router.post("/{user_id}/accept", response_model=FriendOut)
async def accept_request(user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> FriendOut:
    row = await session.get(Friendship, (user_id, user.id), with_for_update=True)
    if row is None or row.status != FriendshipStatus.pending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No pending request from this user")
    row.status = FriendshipStatus.accepted
    await session.commit()
    await _announce(session, row)
    return await _out(session, row, user.id)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_friend(user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Declines or cancels a request, or ends a friendship."""
    rows = await session.scalars(
        delete(Friendship)
        .where(social.between(user.id, user_id), Friendship.status != FriendshipStatus.blocked)
        .returning(Friendship.requester_id)
    )
    if rows.first() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not a friend or request")
    await session.commit()
    await _announce_removed(user.id, user_id)
    await _announce_removed(user_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/block", response_model=FriendOut)
async def block_user(user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> FriendOut:
    """Blocking also ends any friendship or pending request between the two."""
    other = await _other_user(session, user.id, user_id)
    if other.is_official and other.is_bot:
        # Its messages are security notices among others: it can be silenced, not blocked.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Não dá pra bloquear a conta oficial do Aureum. Você pode silenciar a conversa.",
        )
    rows = await social.pair_rows(session, user.id, user_id)
    mine = next((r for r in rows if r.requester_id == user.id and r.status == FriendshipStatus.blocked), None)
    had_relation = False
    for row in rows:
        if row.status != FriendshipStatus.blocked:
            await session.delete(row)
            had_relation = True
    if mine is None:
        await session.flush()  # the deleted request may have had this same primary key
        mine = Friendship(requester_id=user.id, addressee_id=user_id, status=FriendshipStatus.blocked)
        session.add(mine)
    await session.commit()
    await session.refresh(mine)
    if had_relation:
        await _announce_removed(user_id, user.id)
    await _announce(session, mine)
    return await _out(session, mine, user.id)


@router.delete("/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
async def unblock_user(user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    rows = await session.scalars(
        delete(Friendship)
        .where(
            Friendship.requester_id == user.id,
            Friendship.addressee_id == user_id,
            Friendship.status == FriendshipStatus.blocked,
        )
        .returning(Friendship.requester_id)
    )
    if rows.first() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="This user isn't blocked")
    await session.commit()
    await _announce_removed(user.id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
