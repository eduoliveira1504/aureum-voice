"""What every addon is made of, and the one way addon code reaches a channel.

An addon is a self-contained package in app/addons/<key>/ (see
docs/decisions/0013-addon-framework.md). It never checks permissions or loads channels by
itself: its routes call `addon_channel`, which hands back the channel's id as a generic
`workspace_id`, so the addon's own tables don't need to know what a server or a channel is.
"""

import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import get_channel_for_member
from app.models import Channel, ChannelType
from app.permissions import Perm, ServerAccess, channel_viewers
from app.realtime import broker

# Removes an addon's data for a workspace that is going away (its channel or server was deleted).
CleanupHook = Callable[[AsyncSession, list[uuid.UUID]], Awaitable[None]]


@dataclass(frozen=True)
class AddonManifest:
    key: str
    name: str
    description: str
    # A Lucide icon name, a hint for clients that don't ship the addon's own UI.
    icon: str
    # Mounted at /api/addons/<key>.
    router: APIRouter | None = None
    # The shape of channels.config for this addon; None means it takes no settings.
    config_model: type[BaseModel] | None = None
    # Named actions and the channel permission each needs. "view" is always VIEW_CHANNEL.
    permissions: Mapping[str, Perm] = field(default_factory=dict)
    on_cleanup: CleanupHook | None = None

    def action_perm(self, action: str) -> Perm:
        if action == "view":
            return Perm.VIEW_CHANNEL
        return self.permissions[action]

    def parse_config(self, data: dict[str, Any] | None) -> dict[str, Any]:
        """Validates settings against the addon's model and fills in its defaults."""
        if self.config_model is None:
            if data:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This addon takes no settings")
            return {}
        try:
            return self.config_model.model_validate(data or {}).model_dump(mode="json")
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid addon settings: {e}") from None


@dataclass
class AddonChannel:
    """An addon channel as its addon sees it."""

    manifest: AddonManifest
    channel: Channel
    access: ServerAccess
    session: AsyncSession

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.channel.id

    @property
    def config(self) -> dict[str, Any]:
        # Re-validated so settings saved before a new field existed get its default.
        return self.manifest.parse_config(self.channel.config)

    def can(self, action: str) -> bool:
        return bool(self.access.channel(self.channel) & self.manifest.action_perm(action))

    def require(self, action: str) -> None:
        if not self.can(action):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You don't have permission to do this")

    async def publish(self, event: str, data: dict[str, Any]) -> None:
        """Sends `addon.<key>.<event>` to everyone who can see the channel."""
        payload = {"channel_id": str(self.channel.id), "server_id": str(self.channel.server_id), **data}
        await broker.publish(f"addon.{self.manifest.key}.{event}", payload, await channel_viewers(self.session, self.channel))


async def addon_channel(
    session: AsyncSession, manifest: AddonManifest, channel_id: uuid.UUID, user_id: uuid.UUID, action: str = "view"
) -> AddonChannel:
    """The channel, if it runs this addon and the user may perform `action` there. Channels the
    user can't see, and channels of another kind, are 404."""
    channel, access = await get_channel_for_member(session, channel_id, user_id)
    if channel.type != ChannelType.addon or channel.addon_key != manifest.key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Channel not found")
    ctx = AddonChannel(manifest, channel, access, session)
    ctx.require(action)
    return ctx
