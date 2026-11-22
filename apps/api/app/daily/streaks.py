"""Streaks per daily game and their badges (block 4.2.13; see docs/decisions/0053-daily-games.md).

A game's streak counts the days in a row its puzzle was solved. Every 7 days of it earn a freeze
(up to 2 kept); a day without playing spends one and the streak goes on (that day doesn't count),
or, with none left, the streak is over. Today only counts as missed once it's over.

Each game has one badge that follows the current streak, in levels: 3, 7, 30, 90, 180 and 365 days.
Losing the streak takes the badge down with it (Eduardo's choice, 22/11); the freezes soften that.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from app.models import BadgeRarity

LEVELS = (3, 7, 30, 90, 180, 365)
FREEZE_EVERY = 7
MAX_FREEZES = 2


@dataclass(frozen=True)
class Streak:
    days: int
    freezes: int


def streak_of(played: Iterable[date], today: date) -> Streak:
    """The streak and freezes as of today, from the days the game was solved."""
    days = set(played)
    if not days:
        return Streak(0, 0)
    count = freezes = 0
    day = min(days)
    while day <= today:
        if day in days:
            count += 1
            if count % FREEZE_EVERY == 0:
                freezes = min(MAX_FREEZES, freezes + 1)
        elif day < today:
            if count and freezes:
                freezes -= 1
            else:
                count = 0
        day += timedelta(days=1)
    return Streak(count, freezes)


def level_of(days: int) -> int | None:
    """The highest level the streak reached, or None below the first."""
    reached = [level for level in LEVELS if days >= level]
    return reached[-1] if reached else None


def badge_key(game: str, level: int) -> str:
    return f"daily_{game}_{level}"


def badge_prefix(game: str) -> str:
    return f"daily_{game}_"


# --- Badge art --------------------------------------------------------------------------------
# The hexagon of the other badges; the metal follows the rarity (bronze, silver, gold), the game's
# symbol sits in the middle and a plate shows the days.

# Mythic stays for Fundador and Pioneiro (Eduardo, 22/11): the streak badges top out at legendary.
RARITY = {3: BadgeRarity.comum, 7: BadgeRarity.comum, 30: BadgeRarity.rara, 90: BadgeRarity.rara, 180: BadgeRarity.lendaria, 365: BadgeRarity.lendaria}
METAL = {
    BadgeRarity.comum: ("#D08A4E", "#2B1C10"),
    BadgeRarity.rara: ("#C9D1DA", "#1C2228"),
    BadgeRarity.lendaria: ("#E8B531", "#2A1F08"),
    BadgeRarity.mitica: ("#E8B531", "#2A1F08"),
}
HEXAGON = "48,10 80.9,29 80.9,67 48,86 15.1,67 15.1,29"
GLYPHS = {
    # A 3x3 grid with a few numbers.
    "sudoku": (
        '<rect x="31" y="22" width="34" height="34" rx="3" fill="none" stroke="{c}" stroke-width="3"/>'
        '<path d="M42.3 22 V56 M53.7 22 V56 M31 33.3 H65 M31 44.7 H65" stroke="{c}" stroke-width="1.6"/>'
        '<rect x="34" y="25" width="6" height="6" rx="1" fill="{c}"/><rect x="56" y="47" width="6" height="6" rx="1" fill="{c}"/>'
    ),
    # A path joining two dots, turning through the grid.
    "trilha": (
        '<path d="M32 26 H62 V38 H34 V50 H62" fill="none" stroke="{c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
        '<circle cx="32" cy="26" r="4.5" fill="{c}"/><circle cx="62" cy="50" r="4.5" fill="{c}"/>'
    ),
    # A magnifying glass over a line of letters.
    "cacapalavras": (
        '<circle cx="44" cy="36" r="11" fill="none" stroke="{c}" stroke-width="3.5"/>'
        '<path d="M52 44 L62 54" stroke="{c}" stroke-width="5" stroke-linecap="round"/>'
        '<path d="M38 36 H50" stroke="{c}" stroke-width="2.5" stroke-linecap="round"/>'
    ),
}


def badge_svg(game: str, level: int, *, small: bool = False) -> str:
    rarity = RARITY[level]
    color, fill = METAL[rarity]
    ring = f'<polygon points="48,4 86,26 86,70 48,92 10,70 10,26" fill="none" stroke="{color}" stroke-width="2"/>' if rarity == BadgeRarity.mitica else ""
    frame = f'<polygon points="{HEXAGON}" fill="{fill}" stroke="{color}" stroke-width="{6 if small else 3}" stroke-linejoin="round"/>'
    glyph = GLYPHS[game].format(c=color)
    if small:
        # 32 px and below: the symbol alone, a bit bigger; the metal tells the level.
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">{frame}<g transform="translate(48 44) scale(1.15) translate(-48 -40)">{glyph}</g></svg>'
    plate = (
        f'<rect x="33" y="61" width="30" height="15" rx="4" fill="{color}"/>'
        f'<text x="48" y="72.5" text-anchor="middle" font-family="Sora, Figtree, sans-serif" font-size="11" font-weight="700" fill="{fill}">{level}</text>'
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">{ring}{frame}{glyph}{plate}</svg>'
