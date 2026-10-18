import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.addons.base import AddonChannel, AddonManifest, addon_channel
from app.addons.notes.models import NotesPage
from app.deps import CurrentUser, SessionDep
from app.permissions import Perm

MAX_LENGTH = 20_000

router = APIRouter()


class NotesConfig(BaseModel):
    # Only people who can manage addons edit the page; everyone else reads it.
    read_only: bool = False


class NotesUpdate(BaseModel):
    content: Annotated[str, Field(max_length=MAX_LENGTH)]
    # The version the edit was based on.
    version: Annotated[int, Field(ge=0)]


class NotesOut(BaseModel):
    content: str
    version: int
    updated_by: uuid.UUID | None
    updated_at: datetime | None
    can_edit: bool


async def cleanup(session: AsyncSession, workspace_ids: list[uuid.UUID]) -> None:
    await session.execute(delete(NotesPage).where(NotesPage.workspace_id.in_(workspace_ids)))


def _can_edit(ctx: AddonChannel) -> bool:
    return ctx.can("manage") if ctx.config["read_only"] else ctx.can("edit")


def _out(page: NotesPage | None, ctx: AddonChannel) -> NotesOut:
    if page is None:
        return NotesOut(content="", version=0, updated_by=None, updated_at=None, can_edit=_can_edit(ctx))
    return NotesOut(
        content=page.content,
        version=page.version,
        updated_by=page.updated_by,
        updated_at=page.updated_at,
        can_edit=_can_edit(ctx),
    )


@router.get("/channels/{channel_id}", response_model=NotesOut)
async def get_page(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> NotesOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    return _out(await session.get(NotesPage, ctx.workspace_id), ctx)


@router.put("/channels/{channel_id}", response_model=NotesOut)
async def save_page(channel_id: uuid.UUID, body: NotesUpdate, user: CurrentUser, session: SessionDep) -> NotesOut:
    ctx = await addon_channel(session, manifest, channel_id, user.id)
    if not _can_edit(ctx):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You don't have permission to do this")
    page = await session.get(NotesPage, ctx.workspace_id, with_for_update=True)
    if (page.version if page else 0) != body.version:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="The page changed since you opened it")
    if page is None:
        page = NotesPage(workspace_id=ctx.workspace_id, version=0)
        session.add(page)
    page.content = body.content
    page.version += 1
    page.updated_by = user.id
    try:
        await session.commit()
    except IntegrityError:  # someone else created the page at the same moment
        raise HTTPException(status.HTTP_409_CONFLICT, detail="The page changed since you opened it") from None
    await session.refresh(page)
    out = _out(page, ctx)
    await ctx.publish("updated", out.model_dump(mode="json", exclude={"can_edit"}))
    return out


manifest = AddonManifest(
    key="notes",
    name="Bloco de notas",
    description="Uma página de texto compartilhada pelo canal.",
    icon="notebook-pen",
    router=router,
    config_model=NotesConfig,
    permissions={"edit": Perm.SEND_MESSAGES, "manage": Perm.MANAGE_ADDONS},
    on_cleanup=cleanup,
)
