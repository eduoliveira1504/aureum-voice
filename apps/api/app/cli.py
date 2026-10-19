"""Admin commands, run inside the API container:

    python -m app.cli badges list <username>
    python -m app.cli badges grant <username> <badge>
    python -m app.cli badges revoke <username> <badge>

Badges are granted by the system or whoever runs the server, never by users through the API.
"""

import argparse
import asyncio
import sys

from sqlalchemy import select

from app import badges as badge_rules
from app.config import get_settings
from app.db import SessionLocal
from app.models import User
from app.realtime import broker


def _describe(user: User) -> str:
    held = [f"{g.badge.key}{f' #{g.number}' if g.number else ''}" for g in user.badge_grants]
    return f"{user.username}: {', '.join(held) or '(no badges)'}"


async def badges(action: str, username: str, badge: str | None) -> int:
    if action != "list" and badge not in badge_rules.BADGES:
        known = ", ".join(badge_rules.BADGES)
        print(f"Unknown badge {badge!r}; known badges: {known}", file=sys.stderr)
        return 2
    async with SessionLocal() as session:
        await badge_rules.sync_badges(session)
        user = await session.scalar(select(User).where(User.username == username.lower()))
        if user is None:
            print(f"No user named {username!r}", file=sys.stderr)
            return 1
        assert badge is not None or action == "list"
        changed = False
        if action == "grant":
            owner_name = get_settings().owner_username
            owner = await session.scalar(select(User).where(User.username == owner_name)) if owner_name else None
            try:
                changed = await badge_rules.grant(session, user, badge, granted_by=owner.id if owner else None) is not None
            except badge_rules.BadgeClosed:
                print(f"{badge!r} is beta-only and the beta is over (AUREUM_BETA)", file=sys.stderr)
                return 1
        elif action == "revoke":
            changed = await badge_rules.revoke(session, user, badge)
        if changed:
            await session.commit()
            await badge_rules.announce(session, user)
        print(_describe(user))
    await broker.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    badge_cmd = commands.add_parser("badges", help="list, grant or revoke a user's badges")
    badge_cmd.add_argument("action", choices=("list", "grant", "revoke"))
    badge_cmd.add_argument("username")
    badge_cmd.add_argument("badge", nargs="?")
    args = parser.parse_args()
    return asyncio.run(badges(args.action, args.username, args.badge))


if __name__ == "__main__":
    sys.exit(main())
