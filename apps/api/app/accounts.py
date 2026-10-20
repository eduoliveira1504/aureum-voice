"""Account rules shared by sign-up and the admin commands."""

import unicodedata

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


OFFICIAL_NAME = "aureum"
# Digits and symbols people use as letters ("Aur3um", "@ureum").
_LOOKALIKES = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "|": "l", "!": "i"})


def _skeleton(name: str) -> str:
    """Lowercase ASCII letters and digits only: no accents, spaces or punctuation, so "Aure um",
    "AUREUM" and "Auréum" all become "aureum". Letters from other scripts drop out, which turns
    a look-alike such as a Cyrillic "а" into a missing letter."""
    plain = unicodedata.normalize("NFKD", name).lower().translate(_LOOKALIKES)
    return "".join(c for c in plain if c.isascii() and c.isalnum())


def _distance(a: str, b: str) -> int:
    """Levenshtein distance (short names only)."""
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


def looks_official(name: str) -> bool:
    """A name equal or close to "Aureum" (ignoring case, accents, spaces and look-alike
    characters), or containing it ("Aureum Oficial", "SuporteAureum"). Only official accounts,
    made with the CLI, may carry it."""
    skeleton = _skeleton(name)
    return bool(skeleton) and (OFFICIAL_NAME in skeleton or _distance(skeleton, OFFICIAL_NAME) <= 1)
