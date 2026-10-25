"""Polls addon: a question with options, posted as a message in any chat (server text channel,
DM or group). Single or multiple choice, optional deadline, anonymous or visible votes, live
counts and a result line when it closes.

The first addon that lives in chats instead of an addon channel (ADR 0028): it reaches the host
only through `AddonChat` (send checks, live events, its message and system lines)."""

from app.addons.polls.router import manifest

__all__ = ["manifest"]
