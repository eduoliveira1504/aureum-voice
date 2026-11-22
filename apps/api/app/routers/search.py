"""Search inside a server (block 4.2.4): Postgres full text search, Portuguese config.

Only channels the user can see and whose history they can read (the same rule as the channel's
own history: without READ_HISTORY, nothing from before is shown) are searched. Newest first,
paged with `before` (a message id). The index is `ix_messages_content_search` (migration f3b9d5a7c820).
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, literal_column, select

from app import ratelimit, reactions
from app.deps import CurrentUser, SessionDep
from app.models import Channel, Message
from app.permissions import Perm, server_access
from app.schemas import MessageOut, SearchOut

router = APIRouter(tags=["search"])

# Written into the SQL, not sent as a parameter: the planner only uses the index for this exact
# expression, and a parameter could make it miss.
SEARCH_CONFIG = literal_column("'portuguese'::regconfig")
MAX_LIMIT = 50
# Per person: plenty for typing and paging, not for scraping a server.
SEARCHES = (30, 60)


def search_vector():  # noqa: ANN201
    """The indexed expression: it must stay exactly as in the migration for the index to be used."""
    return func.to_tsvector(SEARCH_CONFIG, Message.content)


@router.get("/servers/{server_id}/search", response_model=SearchOut)
async def search_messages(
    server_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    q: Annotated[str, Query(max_length=200)],
    channel_id: uuid.UUID | None = None,
    author_id: uuid.UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 25,
) -> SearchOut:
    if not q.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Type something to search for")
    channels = list(await session.scalars(select(Channel).where(Channel.server_id == server_id)))
    access = await server_access(session, server_id, user.id, [c.id for c in channels])
    await ratelimit.hit(f"search:{user.id}", *SEARCHES)
    readable = [c.id for c in channels if access.channel(c) & Perm.VIEW_CHANNEL and access.channel(c) & Perm.READ_HISTORY]
    if channel_id is not None:
        # A channel that isn't there, or that the user can't read, gives nothing (ids can't be probed).
        readable = [c for c in readable if c == channel_id]
    if not readable:
        return SearchOut(messages=[], next_before=None)

    query = select(Message).where(
        Message.channel_id.in_(readable),
        search_vector().op("@@")(func.websearch_to_tsquery(SEARCH_CONFIG, q)),
    )
    if author_id is not None:
        query = query.where(Message.author_id == author_id)
    if since is not None:
        query = query.where(Message.created_at >= since)
    if until is not None:
        query = query.where(Message.created_at < until)
    if before is not None:
        query = query.where(Message.id < before)
    rows = list(await session.scalars(query.order_by(Message.id.desc()).limit(limit + 1)))
    more = len(rows) > limit
    rows = rows[:limit]
    summary = await reactions.summaries(session, [m.id for m in rows])
    return SearchOut(
        messages=[MessageOut.model_validate(m).model_copy(update={"reactions": summary.get(m.id, [])}) for m in rows],
        next_before=rows[-1].id if more else None,
    )
