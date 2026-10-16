"""Server roles and who has them. Every change ends in permissions_changed: members refetch
the server, since what they can see and do may have changed."""

import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import images
from app.deps import CurrentUser, SessionDep
from app.models import ChannelOverride, MemberRole, OverrideTarget, Role, Server, ServerMember
from app.permissions import Perm, ServerAccess, server_access
from app.routers.servers import permissions_changed
from app.routers.users import ImageUpload
from app.schemas import RoleCreate, RoleOrder, RoleOut, RoleUpdate

router = APIRouter(tags=["roles"])

MAX_ROLES = 250


async def _manager(session: AsyncSession, server_id: uuid.UUID, user_id: uuid.UUID) -> ServerAccess:
    """The user's access, with MANAGE_ROLES required. Locks the server's row first, so
    concurrent role changes can't scramble positions."""
    await session.execute(select(Server.id).where(Server.id == server_id).with_for_update())
    access = await server_access(session, server_id, user_id)
    access.require(Perm.MANAGE_ROLES)
    return access


async def _role(session: AsyncSession, role_id: uuid.UUID, user_id: uuid.UUID) -> tuple[Role, ServerAccess]:
    """A role the user can manage: in their server and below their highest role."""
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Role not found")
    access = await _manager(session, role.server_id, user_id)
    if not role.is_everyone:
        access.require_outranks(role.position, "this role")
    return role, access


@router.post("/servers/{server_id}/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
async def create_role(server_id: uuid.UUID, body: RoleCreate, user: CurrentUser, session: SessionDep) -> Role:
    """New roles start at the bottom, just above @everyone."""
    access = await _manager(session, server_id, user.id)
    access.require_grantable(body.permissions)
    if await session.scalar(select(func.count()).select_from(Role).where(Role.server_id == server_id)) >= MAX_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Too many roles")
    await session.execute(
        update(Role).where(Role.server_id == server_id, Role.position > 0).values(position=Role.position + 1)
    )
    role = Role(server_id=server_id, position=1, **body.model_dump())
    session.add(role)
    await session.commit()
    await permissions_changed(session, server_id)
    return role


@router.patch("/roles/{role_id}", response_model=RoleOut)
async def update_role(role_id: uuid.UUID, body: RoleUpdate, user: CurrentUser, session: SessionDep) -> Role:
    role, access = await _role(session, role_id, user.id)
    changes = body.model_dump(exclude_unset=True)
    if role.is_everyone and set(changes) - {"permissions"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Only @everyone's permissions can change")
    for field, value in changes.items():
        if value is None and field != "color":  # only the color can be cleared
            continue
        if field == "permissions":
            access.require_grantable(value ^ role.permissions)
        setattr(role, field, value)
    await session.commit()
    await permissions_changed(session, role.server_id)
    return role


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(role_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    role, _ = await _role(session, role_id, user.id)
    if role.is_everyone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="@everyone can't be deleted")
    server_id, position, icon_url = role.server_id, role.position, role.icon_url
    await session.execute(
        delete(ChannelOverride).where(ChannelOverride.target_type == OverrideTarget.role, ChannelOverride.target_id == role_id)
    )
    await session.delete(role)
    await session.flush()
    await session.execute(
        update(Role).where(Role.server_id == server_id, Role.position > position).values(position=Role.position - 1)
    )
    await images.replace(icon_url, None, session.commit)
    await permissions_changed(session, server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/servers/{server_id}/roles/order", response_model=list[RoleOut])
async def reorder_roles(server_id: uuid.UUID, body: RoleOrder, user: CurrentUser, session: SessionDep) -> list[Role]:
    """Takes every role but @everyone, strongest first. Roles at or above the user's highest
    role must keep their place, and nothing can be moved up to it."""
    access = await _manager(session, server_id, user.id)
    roles = {r.id: r for r in await session.scalars(select(Role).where(Role.server_id == server_id, Role.id != server_id))}
    if len(body.role_ids) != len(roles) or set(body.role_ids) != set(roles):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="List every role except @everyone, once")
    new_positions = {role_id: len(body.role_ids) - i for i, role_id in enumerate(body.role_ids)}
    for role_id, position in new_positions.items():
        role = roles[role_id]
        if role.position != position:
            access.require_outranks(max(role.position, position), "roles at or above your highest role")
    for role_id, position in new_positions.items():
        roles[role_id].position = position
    await session.commit()
    await permissions_changed(session, server_id)
    return sorted(
        await session.scalars(select(Role).where(Role.server_id == server_id)), key=lambda r: -r.position
    )


async def _set_icon(role_id: uuid.UUID, upload: ImageUpload | None, user_id: uuid.UUID, session: AsyncSession) -> Role:
    role, _ = await _role(session, role_id, user_id)
    if role.is_everyone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="@everyone has no icon")
    new_url = await images.store_upload(upload, f"roles/{role.server_id}") if upload else None
    old_url = role.icon_url
    role.icon_url = new_url
    await images.replace(old_url, new_url, session.commit)
    await permissions_changed(session, role.server_id)
    return role


@router.post("/roles/{role_id}/icon", response_model=RoleOut)
async def upload_role_icon(role_id: uuid.UUID, file: ImageUpload, user: CurrentUser, session: SessionDep) -> Role:
    return await _set_icon(role_id, file, user.id, session)


@router.delete("/roles/{role_id}/icon", response_model=RoleOut)
async def remove_role_icon(role_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Role:
    return await _set_icon(role_id, None, user.id, session)


# --- Member roles -----------------------------------------------------------------


async def _assignable(
    session: AsyncSession, server_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, actor_id: uuid.UUID
) -> None:
    access = await _manager(session, server_id, actor_id)
    role = await session.get(Role, role_id)
    if role is None or role.server_id != server_id or role.is_everyone:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Role not found")
    if await session.get(ServerMember, (server_id, user_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
    access.require_outranks(role.position, "this role")


@router.put("/servers/{server_id}/members/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_member_role(
    server_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> Response:
    await _assignable(session, server_id, user_id, role_id, user.id)
    await session.execute(
        insert(MemberRole).values(server_id=server_id, user_id=user_id, role_id=role_id).on_conflict_do_nothing()
    )
    await session.commit()
    await permissions_changed(session, server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/servers/{server_id}/members/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member_role(
    server_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> Response:
    await _assignable(session, server_id, user_id, role_id, user.id)
    await session.execute(
        delete(MemberRole).where(
            MemberRole.server_id == server_id, MemberRole.user_id == user_id, MemberRole.role_id == role_id
        )
    )
    await session.commit()
    await permissions_changed(session, server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
