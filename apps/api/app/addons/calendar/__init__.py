"""Calendar addon: month, week and list views of what has a date in the server's other addons
(events, the Kanban board's due dates and, later, others), through their dated_items hook. It
keeps nothing of its own: no tables, no migrations, nothing to clean up."""

from app.addons.calendar.router import manifest

__all__ = ["manifest"]
