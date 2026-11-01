import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import categories
from app.deps import CurrentUser, SessionDep
from app.models import Channel, ChannelCategory, ChannelCategoryOverride, OverrideTarget, Role, ServerMember
from app.permissions import CHANNEL_PERMS, Perm, ServerAccess, channel_overwrites, server_access
from app.routers.servers import category_out, channel_out, permissions_changed
from app.schemas import CategoryCreate, CategoryOrder, CategoryOut, CategoryUpdate, ChannelArrange, ChannelOut, OverrideSet

router = APIRouter(tags=["categories"])


async def _visible_category(
    session: AsyncSession, category_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[ChannelCategory, ServerAccess, list[categories.Overwrite]]:
    """The category, if the user sees it; 404 otherwise, so hidden ones can't be probed."""
    category = await session.get(ChannelCategory, category_id)
    not_found = HTTPException(status.HTTP_404_NOT_FOUND, detail="Category not found")
    if category is None or await session.get(ServerMember, (category.server_id, user_id)) is None:
        raise not_found
    channels = list(await session.scalars(select(Channel).where(Channel.category_id == category_id)))
    access = await server_access(session, category.server_id, user_id, [c.id for c in channels])
    overwrites = (await categories.overwrites_of(session, [category_id]))[category_id]
    seen = [c for c in channels if access.can_view(c)]
    if not categories.visible([category], access.ctx, user_id, {category_id: overwrites}, seen):
        raise not_found
    return category, access, overwrites


async def _out(session: AsyncSession, category: ChannelCategory) -> CategoryOut:
    return category_out(category, (await categories.overwrites_of(session, [category.id]))[category.id])


@router.post("/servers/{server_id}/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(server_id: uuid.UUID, body: CategoryCreate, user: CurrentUser, session: SessionDep) -> CategoryOut:
    (await server_access(session, server_id, user.id)).require(Perm.MANAGE_CHANNELS)
    existing = await categories.of_server(session, server_id)
    if len(existing) >= categories.MAX_PER_SERVER:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A server can have up to {categories.MAX_PER_SERVER} categories")
    category = ChannelCategory(server_id=server_id, name=body.name, position=existing[-1].position + 1 if existing else 0)
    session.add(category)
    await session.commit()
    await permissions_changed(session, server_id)
    return category_out(category, [])


@router.put("/servers/{server_id}/categories/order", response_model=list[CategoryOut])
async def reorder_categories(server_id: uuid.UUID, body: CategoryOrder, user: CurrentUser, session: SessionDep) -> list[CategoryOut]:
    """The categories the user sees, in the new order; the hidden ones keep their place."""
    access = await server_access(session, server_id, user.id)
    access.require(Perm.MANAGE_CHANNELS)
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"channel_order:{server_id}"})
    every = await categories.of_server(session, server_id)
    overwrites = await categories.overwrites_of(session, [c.id for c in every])
    channels = list(await session.scalars(select(Channel).where(Channel.server_id == server_id)))
    access = await server_access(session, server_id, user.id, [c.id for c in channels])
    shown = categories.visible(every, access.ctx, user.id, overwrites, [c for c in channels if access.can_view(c)])
    if len(body.category_ids) != len(shown) or set(body.category_ids) != {c.id for c in shown}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="List every category you can see, once")
    by_id = {c.id: c for c in shown}
    moved = iter(by_id[i] for i in body.category_ids)
    for position, category in enumerate([next(moved) if c.id in by_id else c for c in every]):
        category.position = position
    await session.commit()
    await permissions_changed(session, server_id)
    return [category_out(by_id[i], overwrites[i]) for i in body.category_ids]


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(category_id: uuid.UUID, body: CategoryUpdate, user: CurrentUser, session: SessionDep) -> CategoryOut:
    category, access, _ = await _visible_category(session, category_id, user.id)
    access.require(Perm.MANAGE_CHANNELS)
    category.name = body.name
    await session.commit()
    await permissions_changed(session, category.server_id)
    return await _out(session, category)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    """Its channels stay, without a category and with the permissions they have now."""
    category, access, _ = await _visible_category(session, category_id, user.id)
    access.require(Perm.MANAGE_CHANNELS)
    server_id = category.server_id
    await session.execute(
        update(Channel).where(Channel.category_id == category_id).values(category_id=None, permissions_synced=False)
    )
    await session.delete(category)
    await session.commit()
    await permissions_changed(session, server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/servers/{server_id}/channels/arrange", response_model=list[ChannelOut])
async def arrange_channels(server_id: uuid.UUID, body: ChannelArrange, user: CurrentUser, session: SessionDep) -> list[ChannelOut]:
    """One category's channels the user can see, in the new order, including any coming from
    elsewhere (`category_id` null: the ones without a category). Hidden ones keep their place.
    A channel that moves keeps its permissions; it's synced only if they match the new category."""
    access = await server_access(session, server_id, user.id)
    access.require(Perm.MANAGE_CHANNELS)
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"channel_order:{server_id}"})
    channels = list(
        await session.scalars(select(Channel).where(Channel.server_id == server_id).order_by(Channel.position, Channel.name, Channel.id))
    )
    overwrites = await channel_overwrites(session, [c.id for c in channels])
    access = ServerAccess(access.ctx, user.id, overwrites)
    target: list[categories.Overwrite] = []
    if body.category_id is not None:
        category = await session.get(ChannelCategory, body.category_id)
        if category is None or category.server_id != server_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Category not found")
        target = (await categories.overwrites_of(session, [category.id]))[category.id]
    visible = {c.id: c for c in channels if access.can_view(c)}
    here = {c.id for c in visible.values() if c.category_id == body.category_id}
    listed = set(body.channel_ids)
    if len(listed) != len(body.channel_ids) or not here <= listed or not listed <= set(visible):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="List every channel you can see in this category, once")
    moved = iter(visible[i] for i in body.channel_ids)
    ordered = [next(moved) if c.id in listed else c for c in channels]
    for position, channel in enumerate(ordered):
        channel.position = position
    for channel_id in listed - here:
        channel = visible[channel_id]
        channel.category_id = body.category_id
        channel.permissions_synced = body.category_id is not None and categories.same_overwrites(overwrites[channel_id], target)
    await session.commit()
    await permissions_changed(session, server_id)
    return [channel_out(visible[i], overwrites[i]) for i in body.channel_ids]


# --- Permissions ----------------------------------------------------------------


async def _check_override(
    session: AsyncSession,
    category: ChannelCategory,
    access: ServerAccess,
    overwrites: list[categories.Overwrite],
    target_type: OverrideTarget,
    target_id: uuid.UUID,
    changed: int,
) -> None:
    """The same rules as a channel's overrides, inside the category."""
    mine = categories.permissions_in(access.ctx, access.user_id, overwrites)
    if not mine & Perm.MANAGE_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Missing permission")
    if target_type == OverrideTarget.role:
        role = await session.get(Role, target_id)
        if role is None or role.server_id != category.server_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Role not found")
        if not role.is_everyone:
            access.require_outranks(role.position, "this role")
    else:
        if await session.get(ServerMember, (category.server_id, target_id)) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
        access.require_outranks(access.ctx.rank(target_id), "this member")
    access.require_grantable(changed, within=mine)


async def _overrides_changed(session: AsyncSession, category: ChannelCategory) -> CategoryOut:
    """Passes the category's overrides on to the channels that follow it."""
    overwrites = (await categories.overwrites_of(session, [category.id]))[category.id]
    synced = await session.scalars(
        select(Channel.id).where(Channel.category_id == category.id, Channel.permissions_synced.is_(True))
    )
    await categories.copy_to_channels(session, overwrites, list(synced))
    await session.commit()
    await permissions_changed(session, category.server_id)
    return category_out(category, overwrites)


@router.put("/categories/{category_id}/overrides/{target_type}/{target_id}", response_model=CategoryOut)
async def set_override(
    category_id: uuid.UUID,
    target_type: OverrideTarget,
    target_id: uuid.UUID,
    body: OverrideSet,
    user: CurrentUser,
    session: SessionDep,
) -> CategoryOut:
    category, access, overwrites = await _visible_category(session, category_id, user.id)
    if body.allow & body.deny:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A permission can't be both allowed and denied")
    if (body.allow | body.deny) & ~int(CHANNEL_PERMS):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only channel permissions can be overridden")
    current = await session.get(ChannelCategoryOverride, (category_id, target_type, target_id))
    old_allow, old_deny = (current.allow, current.deny) if current else (0, 0)
    changed = (body.allow ^ old_allow) | (body.deny ^ old_deny)
    await _check_override(session, category, access, overwrites, target_type, target_id, changed)
    await session.execute(
        insert(ChannelCategoryOverride)
        .values(category_id=category_id, target_type=target_type, target_id=target_id, allow=body.allow, deny=body.deny)
        .on_conflict_do_update(
            index_elements=[ChannelCategoryOverride.category_id, ChannelCategoryOverride.target_type, ChannelCategoryOverride.target_id],
            set_={"allow": body.allow, "deny": body.deny},
        )
    )
    await session.flush()
    return await _overrides_changed(session, category)


@router.delete("/categories/{category_id}/overrides/{target_type}/{target_id}", response_model=CategoryOut)
async def remove_override(
    category_id: uuid.UUID, target_type: OverrideTarget, target_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> CategoryOut:
    category, access, overwrites = await _visible_category(session, category_id, user.id)
    override = await session.get(ChannelCategoryOverride, (category_id, target_type, target_id))
    if override is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Override not found")
    await _check_override(session, category, access, overwrites, target_type, target_id, override.allow | override.deny)
    await session.delete(override)
    await session.flush()
    return await _overrides_changed(session, category)


@router.post("/channels/{channel_id}/permissions/sync", response_model=ChannelOut)
async def sync_channel(channel_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> ChannelOut:
    """Back to the category's permissions, dropping the channel's own."""
    channel = await session.get(Channel, channel_id)
    if channel is None or channel.server_id is None or await session.get(ServerMember, (channel.server_id, user.id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Channel not found")
    access = await server_access(session, channel.server_id, user.id, [channel_id])
    if not access.can_view(channel):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Channel not found")
    access.require_in(channel, Perm.MANAGE_ROLES)
    if channel.category_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This channel has no category")
    overwrites = (await categories.overwrites_of(session, [channel.category_id]))[channel.category_id]
    await categories.copy_to_channels(session, overwrites, [channel_id])
    channel.permissions_synced = True
    await session.commit()
    await permissions_changed(session, channel.server_id)
    return channel_out(channel, overwrites)
