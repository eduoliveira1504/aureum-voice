"""When an event happens: its occurrences. A one-off event has one (number 0); a weekly one
repeats every 7 days at the same wall-clock time in the zone it was created in, so it stays at
20:00 across daylight-saving changes."""

import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WEEK = timedelta(weeks=1)


@dataclass(frozen=True)
class Occurrence:
    index: int
    starts_at: datetime
    ends_at: datetime


def valid_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def occurrence(starts_at: datetime, ends_at: datetime, zone: str, index: int) -> Occurrence:
    """The `index`-th occurrence of a weekly series that started at `starts_at` (index 0 is that
    one). The length stays the same."""
    if index == 0:
        return Occurrence(0, starts_at, ends_at)
    tz = ZoneInfo(zone)
    local = starts_at.astimezone(tz).replace(tzinfo=None) + index * WEEK
    start = local.replace(tzinfo=tz).astimezone(UTC)
    return Occurrence(index, start, start + (ends_at - starts_at))


def _first_index_ending_after(starts_at: datetime, ends_at: datetime, zone: str, moment: datetime) -> int:
    # A guess from plain weeks, then corrected (a daylight-saving shift moves it by an hour).
    guess = max(0, math.floor((moment - ends_at) / WEEK))
    while guess > 0 and occurrence(starts_at, ends_at, zone, guess - 1).ends_at > moment:
        guess -= 1
    while occurrence(starts_at, ends_at, zone, guess).ends_at <= moment:
        guess += 1
    return guess


def current(starts_at: datetime, ends_at: datetime, zone: str, repeat: str, now: datetime) -> Occurrence | None:
    """The occurrence happening now or next; None once a one-off event is over."""
    if repeat != "weekly":
        return Occurrence(0, starts_at, ends_at) if ends_at > now else None
    return occurrence(starts_at, ends_at, zone, _first_index_ending_after(starts_at, ends_at, zone, now))


def between(
    starts_at: datetime, ends_at: datetime, zone: str, repeat: str, start: datetime, end: datetime, limit: int = 60
) -> list[Occurrence]:
    """The occurrences that overlap [start, end)."""
    if repeat != "weekly":
        return [Occurrence(0, starts_at, ends_at)] if starts_at < end and ends_at > start else []
    out: list[Occurrence] = []
    index = _first_index_ending_after(starts_at, ends_at, zone, start)
    while len(out) < limit:
        occ = occurrence(starts_at, ends_at, zone, index)
        if occ.starts_at >= end:
            break
        out.append(occ)
        index += 1
    return out
