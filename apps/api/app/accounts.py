"""Account rules shared by sign-up and the admin commands."""

# Nobody signs up with these (compared in lowercase; usernames are stored lowercase anyway).
# Accounts with them are made by the admin command (python -m app.cli users create), e.g. the
# official @aureum account for announcements and support.
RESERVED_USERNAMES = frozenset(
    {
        "aureum",
        "admin",
        "administrador",
        "suporte",
        "support",
        "staff",
        "equipe",
        "sistema",
        "system",
        "oficial",
        "official",
        "moderador",
        "mod",
    }
)


def is_reserved(username: str) -> bool:
    return username.strip().lower() in RESERVED_USERNAMES
