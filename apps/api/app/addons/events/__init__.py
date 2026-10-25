"""Events addon: meetups with a time, a place (a voice room or free text), an optional cover and
weekly repeats; Vou / Talvez / Não vou per occurrence, reminders from @aureum and a place in
calendars (dated_items).

Like the other addons, nothing here knows about servers: its tables hang off a generic
`workspace_id`, and it reaches the host only through `AddonChannel`."""

from app.addons.events.router import manifest

__all__ = ["manifest"]
