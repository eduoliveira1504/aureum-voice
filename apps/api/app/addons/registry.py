"""The addons this API runs. Adding one: create app/addons/<key>/, list its manifest here and
its migrations folder in alembic.ini (version_locations)."""

import uuid
from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.addons.base import AddonManifest

ADDONS: dict[str, AddonManifest] = {a.key: a for a in ()}


def get_addon(key: str | None) -> AddonManifest | None:
    return ADDONS.get(key) if key else None


async def cleanup(session: AsyncSession, channels: Iterable[tuple[str | None, uuid.UUID]]) -> None:
    """Lets each addon drop its data for channels about to be deleted: (addon_key, channel_id)
    pairs. Runs in the caller's transaction."""
    by_addon: dict[str, list[uuid.UUID]] = {}
    for key, channel_id in channels:
        if key:
            by_addon.setdefault(key, []).append(channel_id)
    for key, ids in by_addon.items():
        addon = ADDONS.get(key)
        if addon and addon.on_cleanup:
            await addon.on_cleanup(session, ids)
