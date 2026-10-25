"""Whiteboard addon: boards drawn together with Excalidraw on the desktop. Several boards per
channel, live per-element sync, images in object storage, versions to restore.

Like the Kanban board, nothing here knows about servers or channels: its tables hang off a
generic `workspace_id` that the addon framework hands over, and it reaches the host only through
`AddonChannel` (permissions, events, system lines) and the socket context (live cursors)."""

from app.addons.whiteboard.router import manifest

__all__ = ["manifest"]
