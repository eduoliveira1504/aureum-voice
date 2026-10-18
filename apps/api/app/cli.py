"""Admin commands, run inside the API container:

    python -m app.cli badges list <username>
    python -m app.cli badges grant <username> <badge>
    python -m app.cli badges revoke <username> <badge>

Badges are granted by whoever runs the server, never by users through the API.
"""

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.access import audience_ids
from app.db import SessionLocal
from app.models import User
from app.realtime import broker
from app.schemas import BADGES, UserPublic


async def badges(action: str, username: str, badge: str | None) -> int:
    if action != "list" and badge not in BADGES:
        print(f"Unknown badge {badge!r}; known badges: {', '.join(BADGES)}", file=sys.stderr)
        return 2
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.username == username.lower()))
        if user is None:
            print(f"No user named {username!r}", file=sys.stderr)
            return 1
        if action != "list":
            current = [b for b in user.badges if b != badge]
            # Keep the order of BADGES, so every profile lists them the same way.
            user.badges = [b for b in BADGES if b in current or (action == "grant" and b == badge)]
            await session.commit()
            data = UserPublic.model_validate(user).model_dump(mode="json")
            await broker.publish("user.updated", data, await audience_ids(session, user.id))
        print(f"{user.username}: {', '.join(user.badges) or '(no badges)'}")
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
