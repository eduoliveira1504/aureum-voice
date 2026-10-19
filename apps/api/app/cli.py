"""Admin commands, run inside the API container (from the repository root):

    docker compose --env-file .env -f infra/docker-compose.yml exec api python -m app.cli <command>

    python -m app.cli users create <username> --email <e-mail> [--display-name <name>]
    python -m app.cli badges list <username>
    python -m app.cli badges grant <username> <badge>
    python -m app.cli badges revoke <username> <badge>

`users create` makes accounts sign-up refuses, like the reserved names (app/accounts.py), e.g.
the official @aureum account. It asks for the password; these accounts get no beta badge.
Badges are granted by the system or whoever runs the server, never by users through the API.
"""

import argparse
import asyncio
import getpass
import sys

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import or_, select

from app import badges as badge_rules
from app.config import get_settings
from app.db import SessionLocal
from app.models import User
from app.realtime import broker
from app.schemas import DisplayName, LowerEmail, Username
from app.security import hash_password


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


def _valid(kind: object, value: str, what: str) -> str:
    try:
        return str(TypeAdapter(kind).validate_python(value))
    except ValidationError:
        raise SystemExit(f"Invalid {what}: {value!r}") from None


async def create_user(username: str, email: str, display_name: str | None, password: str) -> int:
    """Creates an account directly, reserved names included (no invite, no beta badge)."""
    username = _valid(Username, username, "username (3-32 letters, digits, _ or .)")
    email = _valid(LowerEmail, email, "e-mail")
    display_name = _valid(DisplayName, display_name or username, "display name")
    if len(password) < 8 or len(password) > 128:
        print("The password needs 8 to 128 characters", file=sys.stderr)
        return 2
    async with SessionLocal() as session:
        await badge_rules.sync_badges(session)
        taken = await session.scalar(select(User).where(or_(User.username == username, User.email == email)))
        if taken is not None:
            field = "username" if taken.username == username else "e-mail"
            print(f"That {field} is already taken", file=sys.stderr)
            return 1
        user = User(
            username=username, email=email, display_name=display_name,
            password_hash=hash_password(password), badge_grants=[],
        )
        session.add(user)
        await session.flush()
        # The owner's account still gets Founder (while the beta runs); never the beta badge.
        if username == get_settings().owner_username:
            try:
                await badge_rules.grant(session, user, badge_rules.FOUNDER)
            except badge_rules.BadgeClosed:
                pass
        await session.commit()
        print(f"Created @{user.username} ({user.id}). {_describe(user)}")
    await broker.close()
    return 0


def _ask_password() -> str:
    first = getpass.getpass("Password: ")
    if getpass.getpass("Repeat the password: ") != first:
        raise SystemExit("The passwords don't match")
    return first


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    users_cmd = commands.add_parser("users", help="create accounts, reserved names included")
    users_cmd.add_argument("action", choices=("create",))
    users_cmd.add_argument("username")
    users_cmd.add_argument("--email", required=True)
    users_cmd.add_argument("--display-name")
    badge_cmd = commands.add_parser("badges", help="list, grant or revoke a user's badges")
    badge_cmd.add_argument("action", choices=("list", "grant", "revoke"))
    badge_cmd.add_argument("username")
    badge_cmd.add_argument("badge", nargs="?")
    args = parser.parse_args()
    if args.command == "users":
        return asyncio.run(create_user(args.username, args.email, args.display_name, _ask_password()))
    return asyncio.run(badges(args.action, args.username, args.badge))


if __name__ == "__main__":
    sys.exit(main())
