"""Server types and what each one can have: the only list of it, the app reads it from the API.

A server's type is picked when it's created and never changes (block 4.2.1, ADR 0048). The keys
are addon keys from app.addons.registry plus server features that aren't addons:
- "soundboard": the server's sound panel (app/routers/soundboard.py).

Polls live in chats: in a server they follow this list, in DMs and groups they're always there.
"""

from dataclasses import dataclass

from app.models import ServerType

SOUNDBOARD = "soundboard"

# Server features gated by type that aren't addons in the registry.
FEATURES = frozenset({SOUNDBOARD})


@dataclass(frozen=True)
class ServerTypeInfo:
    type: ServerType
    name: str
    # One line on what comes with the type, for the cards on the create screen.
    description: str
    keys: frozenset[str]


SERVER_TYPES: dict[ServerType, ServerTypeInfo] = {
    t.type: t
    for t in (
        ServerTypeInfo(
            ServerType.game,
            "Jogo",
            "Pra jogar junto: enquetes, eventos, calendário e painel de sons.",
            frozenset({"polls", "events", "calendar", SOUNDBOARD}),
        ),
        ServerTypeInfo(
            ServerType.work,
            "Trabalho",
            "Pra times: kanban, quadro branco, enquetes, eventos e calendário.",
            frozenset({"polls", "events", "calendar", "kanban", "whiteboard"}),
        ),
        ServerTypeInfo(
            ServerType.mixed,
            "Misto",
            "Tudo junto: os addons de jogo e de trabalho.",
            frozenset({"polls", "events", "calendar", "kanban", "whiteboard", SOUNDBOARD}),
        ),
    )
}


def allowed_keys(type_: ServerType) -> frozenset[str]:
    return SERVER_TYPES[type_].keys


def allows(type_: ServerType, key: str | None) -> bool:
    return key is not None and key in SERVER_TYPES[type_].keys
