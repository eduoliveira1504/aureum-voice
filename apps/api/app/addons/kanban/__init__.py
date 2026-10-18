"""Kanban board addon: columns, cards (title, description, assignee, labels, due date), drag
between columns, live updates and a change history.

Meant to become a product of its own one day, so nothing here knows about servers or channels:
its tables hang off a generic `workspace_id` that the addon framework hands over, and it reaches
the host only through `AddonChannel` (permissions, members, events, system lines)."""

from app.addons.kanban.router import manifest

__all__ = ["manifest"]
