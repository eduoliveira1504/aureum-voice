"""The addons this API runs. Adding one: create app/addons/<key>/, list its manifest here and
its migrations folder in alembic.ini (version_locations)."""

import uuid
from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.addons.base import AddonManifest
from app.addons.kanban import manifest as kanban
from app.addons.whiteboard import manifest as whiteboard

ADDONS: dict[str, AddonManifest] = {a.key: a for a in (kanban, whiteboard)}


def get_addon(key: str | None) -> AddonManifest | None:
    return ADDONS.get(key) if key else None


async def cleanup(session: AsyncSession, channels: Iterable[tuple[str | None, uuid.UUID]]) -> list[str]:
    """Lets each addon drop its data for channels about to be deleted: (addon_key, channel_id)
    pairs. Runs in the caller's transaction and returns the stored files to delete after it
    commits."""
    by_addon: dict[str, list[uuid.UUID]] = {}
    for key, channel_id in channels:
        if key:
            by_addon.setdefault(key, []).append(channel_id)
    files: list[str] = []
    for key, ids in by_addon.items():
        addon = ADDONS.get(key)
        if addon and addon.on_cleanup:
            files += await addon.on_cleanup(session, ids) or []
    return files
