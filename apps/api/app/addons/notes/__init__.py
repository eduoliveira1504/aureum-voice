"""Example addon: one shared text page per channel. Small on purpose; it exercises every part
of the addon framework (own table and migrations, router, settings, permissions, events)."""

from app.addons.notes.router import manifest

__all__ = ["manifest"]
