"""Admin commands, run inside the API container (from the repository root):

    docker compose --env-file .env -f infra/docker-compose.yml exec api python -m app.cli <command>

    python -m app.cli users create --username X --email Y [--display-name N] [--password]
                                   [--pioneiro N] [--confirmado] [--oficial] [--verificado] [--bot]
    python -m app.cli users update --username X [--oficial] [--verificado] [--bot]
    python -m app.cli invites create --count N            (single-use account invites)
    python -m app.cli invites create --usos 15 --dias 7   (one group invite)
    python -m app.cli invites create --pioneiro N         (single-use, reserves Pioneiro nº N)
    python -m app.cli servers set-official --server-id X [--off]
    python -m app.cli badges list <username>
    python -m app.cli badges grant <username> <badge>
    python -m app.cli badges revoke <username> <badge>
    python -m app.cli bot status
    python -m app.cli bot enable|disable --acao <ação>   (ações: see app/bot; all start off)
    python -m app.cli bot set-channel --acao <boas-vindas|bugs|avisos> --canal <id>
    python -m app.cli bot say [--canal <id>] "mensagem"   (without --canal: the avisos channel)
    python -m app.cli bot broadcast --categoria <avisos|novidades> "mensagem" [--yes]

`users create` also makes accounts sign-up refuses, like the reserved names (app/accounts.py).
Without --password it makes a strong temporary password, prints it once (never logged) and the
app asks for a new one at the first sign-in; --password asks for one instead. --confirmado
confirms the e-mail right away (Pioneiro, invites, official servers, welcome e-mail), otherwise
the account gets the usual confirmation code. --oficial marks a company account (never the beta
badge nor invites) and also sets --verificado (gold check next to the name) and --bot ("BOT" tag).
Without --oficial, CLI accounts follow the normal rules. `users update` turns those flags on for
an account that already exists (--oficial only if it holds no Pioneiro and no invites).
Badges are granted by the system or whoever runs the server, never by users through the API.
"""

import argparse
import asyncio
import getpass
import secrets
import sys
import uuid
from datetime import UTC, datetime, timedelta

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import or_, select

from app import account_invites, badges as badge_rules, bot, onboarding
from app.bot import broadcast
from app.config import get_settings
from app.db import SessionLocal
from app.models import AccountInvite, Server, User
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
            had = any(g.badge.key == badge for g in user.badge_grants)
            try:
                changed = await badge_rules.grant(session, user, badge, granted_by=owner.id if owner else None) is not None
            except badge_rules.BadgeClosed:
                print(f"{badge!r} is beta-only and the beta is over (AUREUM_BETA)", file=sys.stderr)
                return 1
            if not changed and not had:
                print(f"No Pioneiro numbers left (AUREUM_PIONEER_LIMIT={get_settings().aureum_pioneer_limit})", file=sys.stderr)
                return 1
        elif action == "revoke":
            changed = await badge_rules.revoke(session, user, badge)
        if changed:
            await session.commit()
            await badge_rules.announce(session, user)
            if action == "grant":
                await bot.badge_granted(user.id, badge)
        print(_describe(user))
    await broker.close()
    return 0


def _valid(kind: object, value: str, what: str) -> str:
    try:
        return str(TypeAdapter(kind).validate_python(value))
    except ValidationError:
        raise SystemExit(f"Invalid {what}: {value!r}") from None


def temporary_password() -> str:
    return secrets.token_urlsafe(15)  # 20 characters, ~120 bits


async def create_user(
    username: str, email: str, *, display_name: str | None = None, password: str | None = None,
    pioneer: int | None = None, confirmed: bool = False, official: bool = False,
    verified: bool = False, bot: bool = False,
) -> int:
    """Creates an account directly, reserved names included. No password: a temporary one,
    printed once, that must be replaced at the first sign-in."""
    username = _valid(Username, username.lstrip("@"), "username (3-32 letters, digits, _ or .)")
    email = _valid(LowerEmail, email, "e-mail")
    display_name = _valid(DisplayName, display_name or username, "display name")
    if password is not None and not 8 <= len(password) <= 128:
        print("The password needs 8 to 128 characters", file=sys.stderr)
        return 2
    if official and pioneer is not None:
        print("Official accounts never get the Pioneiro badge", file=sys.stderr)
        return 2
    if pioneer is not None and pioneer < 1:
        print("Pioneiro numbers start at 1", file=sys.stderr)
        return 2
    temporary = password is None
    secret = temporary_password() if temporary else password
    assert secret is not None
    async with SessionLocal() as session:
        await badge_rules.sync_badges(session)
        taken = await session.scalar(select(User).where(or_(User.username == username, User.email == email)))
        if taken is not None:
            field = "username" if taken.username == username else "e-mail"
            print(f"That {field} is already taken", file=sys.stderr)
            return 1
        user = User(
            username=username, email=email, display_name=display_name, password_hash=hash_password(secret),
            is_official=official, is_verified=verified or official, is_bot=bot or official,
            must_change_password=temporary, badge_grants=[],
        )
        session.add(user)
        await session.flush()
        if pioneer is not None:
            try:
                await badge_rules.reserve_pioneer_number(session, pioneer, user_id=user.id)
            except badge_rules.NumberTaken:
                print(f"Pioneiro nº {pioneer} is already reserved or taken", file=sys.stderr)
                return 1
            except badge_rules.PastPioneerLimit:
                print(f"Pioneiro numbers go up to {get_settings().aureum_pioneer_limit} (AUREUM_PIONEER_LIMIT)", file=sys.stderr)
                return 1
        # The owner's account gets Founder while the beta runs.
        if username == get_settings().owner_username:
            try:
                await badge_rules.grant(session, user, badge_rules.FOUNDER)
            except badge_rules.BadgeClosed:
                pass
        result = None
        if confirmed:
            result = await onboarding.confirm(session, user)
        else:
            await onboarding.send_verification(session, user, wait=False)
        await session.commit()
        if result is not None:
            await onboarding.announce(session, user, result)
        await session.refresh(user)
        kind = "official account" if official else "account"
        print(f"Created {kind} @{user.username} ({user.id}). {_describe(user)}{_marks(user)}")
        if not confirmed:
            print("Confirmation code e-mailed.")
        else:
            print("E-mail confirmed." if official else "E-mail confirmed; welcome e-mail queued.")
        if temporary:
            # Shown once, here only: it never goes to a log or the database in clear.
            print(f"Temporary password (shown only now; asked to change at first sign-in): {secret}")
    await broker.close()
    return 0


def _marks(user: User) -> str:
    marks = [name for name, on in (("official", user.is_official), ("verified", user.is_verified), ("bot", user.is_bot)) if on]
    return f" [{', '.join(marks)}]" if marks else ""


async def update_user(username: str, *, official: bool = False, verified: bool = False, bot: bool = False) -> int:
    """Turns the account's marks on. --oficial also means verified and bot, and only goes to an
    account without the beta badge or invites (official accounts never have them)."""
    if not (official or verified or bot):
        print("Nothing to change: pass --oficial, --verificado and/or --bot", file=sys.stderr)
        return 2
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.username == username.lstrip("@").lower()))
        if user is None:
            print(f"No user named {username!r}", file=sys.stderr)
            return 1
        if official and not user.is_official:
            pioneer = any(g.badge.key == badge_rules.PIONEER for g in user.badge_grants)
            invites = await session.scalar(select(AccountInvite.code).where(AccountInvite.owner_id == user.id).limit(1))
            if pioneer or invites:
                print("Official accounts never hold the Pioneiro badge or invites; this one does", file=sys.stderr)
                return 1
        user.is_official = user.is_official or official
        user.is_verified = user.is_verified or verified or official
        user.is_bot = user.is_bot or bot or official
        await session.commit()
        await badge_rules.announce(session, user)
        print(f"Updated @{user.username} ({user.id}).{_marks(user)}")
    await broker.close()
    return 0


async def create_invites(count: int | None, uses: int | None, days: int | None, pioneer: int | None) -> int:
    if pioneer is not None and (uses is not None or (count or 1) != 1):
        print("--pioneiro makes one single-use invite", file=sys.stderr)
        return 2
    if pioneer is not None and pioneer < 1:
        print("Pioneiro numbers start at 1", file=sys.stderr)
        return 2
    async with SessionLocal() as session:
        expires = datetime.now(UTC) + timedelta(days=days) if days else None
        if uses is not None:
            made = [account_invites.create(session, max_uses=uses, expires_at=expires)]
        else:
            made = [account_invites.create(session, expires_at=expires) for _ in range(count or 1)]
        if pioneer is not None:
            await session.flush()
            try:
                await badge_rules.reserve_pioneer_number(session, pioneer, invite_code=made[0].code)
            except badge_rules.NumberTaken:
                print(f"Pioneiro nº {pioneer} is already reserved or taken", file=sys.stderr)
                return 1
            except badge_rules.PastPioneerLimit:
                print(f"Pioneiro numbers go up to {get_settings().aureum_pioneer_limit} (AUREUM_PIONEER_LIMIT)", file=sys.stderr)
                return 1
        await session.commit()
        for invite in made:
            details = [f"{invite.max_uses} uses" if invite.max_uses > 1 else "single use"]
            if invite.expires_at:
                details.append(f"expires {invite.expires_at:%Y-%m-%d %H:%M} UTC")
            if pioneer is not None:
                details.append(f"reserves Pioneiro nº {pioneer}")
            print(f"{account_invites.url(invite.code)}  ({', '.join(details)})")
    return 0


async def set_official(server_id: str, on: bool) -> int:
    try:
        sid = uuid.UUID(server_id)
    except ValueError:
        raise SystemExit(f"Invalid server id: {server_id!r}") from None
    async with SessionLocal() as session:
        server = await session.get(Server, sid)
        if server is None:
            print(f"No server {server_id}", file=sys.stderr)
            return 1
        server.is_official = on
        await session.commit()
        state = "now official: everyone who confirms their e-mail joins it" if on else "no longer official"
        print(f"{server.name} ({server.id}) is {state}.")
    return 0


def _channel_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise SystemExit(f"Invalid channel id: {value!r}") from None


async def bot_status() -> int:
    async with SessionLocal() as session:
        account = await bot.bot_user(session)
        name = get_settings().aureum_bot_username
        print(f"Bot account @{name}: {'ok' if account else 'MISSING (create it with users create --oficial)'}")
        for name in bot.ACTIONS:
            row = await bot.action(session, name)
            channel = ""
            if name in bot.SERVER_ACTIONS:
                channel = f"  canal {row.channel_id}" if row.channel_id else "  (sem canal: não roda)"
            elif name == bot.RELEASES:
                channel = "  (versões novas: canal de avisos + DM)"
            print(f"  {name:<14} {'ligada' if row.enabled else 'desligada'}{channel}")
        print(f"Broadcast DMs waiting: {await broadcast.pending(session)}")
    return 0


async def bot_switch(name: str, on: bool) -> int:
    async with SessionLocal() as session:
        row = await bot.set_action(session, name, enabled=on)
        await session.commit()
        state = "ligada" if on else "desligada"
        print(f"{name}: {state}.")
        if on and name in bot.SERVER_ACTIONS and row.channel_id is None:
            print(f"Sem canal configurado, não roda: bot set-channel --acao {name} --canal <id>")
    return 0


async def bot_set_channel(name: str, channel_id: uuid.UUID) -> int:
    async with SessionLocal() as session:
        channel = await bot.official_text_channel(session, channel_id)
        if channel is None:
            print("That isn't a text channel of an official server (servers set-official)", file=sys.stderr)
            return 1
        row = await bot.set_action(session, name, channel_id=channel.id)
        await session.commit()
        print(f"{name}: canal #{channel.name} ({channel.id}){'' if row.enabled else '; a ação está desligada (bot enable)'}.")
    return 0


async def bot_say(content: str, channel_id: uuid.UUID | None) -> int:
    content = content.strip()
    if not content:
        print("Empty message", file=sys.stderr)
        return 2
    async with SessionLocal() as session:
        if channel_id is None:
            channel_id = (await bot.action(session, bot.NOTICES)).channel_id
            if channel_id is None:
                print("No --canal and no avisos channel (bot set-channel --acao avisos)", file=sys.stderr)
                return 2
        channel = await bot.official_text_channel(session, channel_id)
        account = await bot.bot_user(session)
        if channel is None or account is None:
            print("Needs a text channel of an official server and the bot account", file=sys.stderr)
            return 1
        await bot.post(session, account.id, channel, content, {"category": "say"})
        print(f"Posted in #{channel.name} as @{account.username}.")
    await broker.close()
    return 0


async def bot_broadcast(category: str, content: str, yes: bool) -> int:
    content = content.strip()
    if not content:
        print("Empty message", file=sys.stderr)
        return 2
    async with SessionLocal() as session:
        if await bot.bot_user(session) is None:
            print("The bot account is missing", file=sys.stderr)
            return 1
        key = broadcast.key_of(category, content)
        users = await broadcast.recipients(session, category, key)
        print(f"Categoria {category}: {len(users)} pessoa(s) ainda vão receber esta mensagem.")
        if not users:
            return 0
        if not yes and input("Enviar? [s/N] ").strip().lower() not in ("s", "sim", "y", "yes"):
            print("Cancelado.")
            return 1
        await broadcast.queue(session, category, content, users)
        await session.commit()
        print(f"Na fila. A API envia {broadcast.PER_SECOND} por segundo; rodar o mesmo comando de novo continua de onde parou.")
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
    users_cmd.add_argument("action", choices=("create", "update"))
    users_cmd.add_argument("--username", required=True)
    users_cmd.add_argument("--email", help="required to create")
    users_cmd.add_argument("--display-name")
    users_cmd.add_argument("--password", action="store_true", help="type a password instead of a temporary one")
    users_cmd.add_argument("--pioneiro", type=int, metavar="N", help="reserve this Pioneiro number")
    users_cmd.add_argument("--confirmado", action="store_true", help="e-mail already confirmed")
    users_cmd.add_argument("--oficial", action="store_true", help="company account: no Pioneiro, no invites; verified and bot")
    users_cmd.add_argument("--verificado", action="store_true", help="gold check next to the name")
    users_cmd.add_argument("--bot", action="store_true", help='"BOT" tag next to the name')

    invites_cmd = commands.add_parser("invites", help="create account invites")
    invites_cmd.add_argument("action", choices=("create",))
    invites_cmd.add_argument("--count", type=int, help="how many single-use invites")
    invites_cmd.add_argument("--usos", type=int, help="one group invite with this many spots")
    invites_cmd.add_argument("--dias", type=int, help="days until it expires")
    invites_cmd.add_argument("--pioneiro", type=int, metavar="N", help="reserve this Pioneiro number")

    servers_cmd = commands.add_parser("servers", help="mark a server as official")
    servers_cmd.add_argument("action", choices=("set-official",))
    servers_cmd.add_argument("--server-id", required=True)
    servers_cmd.add_argument("--off", action="store_true", help="stop being official")

    badge_cmd = commands.add_parser("badges", help="list, grant or revoke a user's badges")
    badge_cmd.add_argument("action", choices=("list", "grant", "revoke"))
    badge_cmd.add_argument("username")
    badge_cmd.add_argument("badge", nargs="?")

    bot_cmd = commands.add_parser("bot", help="the official bot @aureum (app/bot)")
    bot_cmd.add_argument("action", choices=("status", "enable", "disable", "set-channel", "say", "broadcast"))
    bot_cmd.add_argument("message", nargs="?", help="say/broadcast: the text (simple markdown)")
    bot_cmd.add_argument("--acao", choices=bot.ACTIONS, help="enable/disable/set-channel: which action")
    bot_cmd.add_argument("--canal", help="set-channel/say: the channel id")
    bot_cmd.add_argument("--categoria", choices=bot.BROADCAST_CATEGORIES, help="broadcast: who gets it")
    bot_cmd.add_argument("--yes", action="store_true", help="broadcast: don't ask for confirmation")

    args = parser.parse_args()
    if args.command == "bot":
        if args.action == "status":
            return asyncio.run(bot_status())
        if args.action in ("enable", "disable"):
            if not args.acao:
                parser.error(f"bot {args.action} needs --acao")
            return asyncio.run(bot_switch(args.acao, args.action == "enable"))
        if args.action == "set-channel":
            if args.acao not in bot.SERVER_ACTIONS or not args.canal:
                parser.error(f"bot set-channel needs --acao ({'|'.join(bot.SERVER_ACTIONS)}) and --canal")
            return asyncio.run(bot_set_channel(args.acao, _channel_id(args.canal)))
        if not args.message:
            parser.error(f"bot {args.action} needs the message text")
        if args.action == "say":
            return asyncio.run(bot_say(args.message, _channel_id(args.canal) if args.canal else None))
        if not args.categoria:
            parser.error("bot broadcast needs --categoria")
        return asyncio.run(bot_broadcast(args.categoria, args.message, args.yes))
    if args.command == "users" and args.action == "update":
        if args.email or args.display_name or args.password or args.pioneiro is not None or args.confirmado:
            parser.error("users update only takes --oficial, --verificado and --bot")
        return asyncio.run(update_user(args.username, official=args.oficial, verified=args.verificado, bot=args.bot))
    if args.command == "users":
        if not args.email:
            parser.error("users create needs --email")
        return asyncio.run(create_user(
            args.username, args.email, display_name=args.display_name,
            password=_ask_password() if args.password else None,
            pioneer=args.pioneiro, confirmed=args.confirmado, official=args.oficial,
            verified=args.verificado, bot=args.bot,
        ))
    if args.command == "invites":
        if args.usos is not None and args.usos < 2:
            parser.error("--usos needs 2 or more (a single-use invite is --count 1)")
        if args.count is not None and not 1 <= args.count <= 100:
            parser.error("--count goes from 1 to 100")
        return asyncio.run(create_invites(args.count, args.usos, args.dias, args.pioneiro))
    if args.command == "servers":
        return asyncio.run(set_official(args.server_id, not args.off))
    return asyncio.run(badges(args.action, args.username, args.badge))


if __name__ == "__main__":
    sys.exit(main())
