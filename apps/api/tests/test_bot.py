"""Block 3.3: the official bot @aureum (app/bot) — welcomes and bug lines in the official server,
read-only official DMs by category, anti-impersonation, broadcasts and the CLI."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app import bot, cli
from app.bot import broadcast, releases
from app.config import get_settings
from app.db import SessionLocal
from app.models import AccountInvite, BotOutbox, BugReport, User, UserSettings
from app.routers import auth as auth_router
from tests.helpers import PASSWORD, ApiUser, make_account_invite, make_server, make_user, text_channel
from tests.test_onboarding import sign_up, verify


@pytest.fixture(autouse=True)
def many_sign_ups(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_router, "REGISTER_PER_IP", (100, 3600))


@pytest.fixture
def beta(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "aureum_beta", True)


@pytest.fixture
async def aureum(capsys: pytest.CaptureFixture[str]) -> uuid.UUID:
    """The official bot account, as the CLI makes it."""
    assert await cli.create_user("aureum", "oficial@aureum.app", official=True, confirmed=True, password=PASSWORD) == 0
    capsys.readouterr()
    async with SessionLocal() as session:
        bot_id = await session.scalar(select(User.id).where(User.username == "aureum"))
    assert bot_id is not None
    return bot_id


async def switch(*actions: str, on: bool = True, **channels: str) -> None:
    async with SessionLocal() as session:
        for name in actions:
            await bot.set_action(session, name, enabled=on)
        for name, channel_id in channels.items():
            await bot.set_action(session, name.replace("_", "-"), channel_id=uuid.UUID(channel_id))
        await session.commit()


async def official_server(owner: ApiUser) -> tuple[dict[str, Any], str, str]:
    """An official server with a welcome channel and a bugs channel."""
    server = await make_server(owner, name="Aureum Beta")
    assert await cli.set_official(server["id"], True) == 0
    welcome_id = text_channel(server)
    bugs = await owner.post(f"/servers/{server['id']}/channels", {"name": "bugs", "type": "text"})
    assert bugs.status_code == 201, bugs.text
    return server, welcome_id, bugs.json()["id"]


async def messages(user: ApiUser, channel_id: str) -> list[dict[str, Any]]:
    res = await user.get(f"/channels/{channel_id}/messages")
    assert res.status_code == 200, res.text
    return res.json()


async def official_dm(user: ApiUser) -> dict[str, Any] | None:
    return next((d for d in (await user.get("/dms")).json() if d["official"]), None)


async def dm_texts(user: ApiUser) -> list[str]:
    dm = await official_dm(user)
    return [m["content"] for m in await messages(user, dm["id"])] if dm else []


async def join(user: ApiUser, server: dict[str, Any], owner: ApiUser) -> None:
    code = (await owner.post(f"/servers/{server['id']}/invites", {})).json()["code"]
    assert (await user.post(f"/invites/{code}/join")).status_code == 200


# --- Official server ------------------------------------------------------------------------


async def test_welcome_with_and_without_pioneer_once_per_person(client: AsyncClient, aureum, beta) -> None:  # noqa: ANN001
    owner = await make_user(client, "owner")
    server, welcome_id, bugs_id = await official_server(owner)
    await switch(bot.WELCOME, bot.BUGS, boas_vindas=welcome_id, bugs=bugs_id)

    tokens = await sign_up(client, "mari")  # joins the official server on confirming, as Pioneiro nº 1
    assert (await verify(client, tokens)).status_code == 200
    plain = await make_user(client, "zeca")  # no Pioneiro
    await join(plain, server, owner)
    await plain.delete(f"/servers/{server['id']}/members/me")
    await join(plain, server, owner)  # came back: no second welcome

    lines = [m for m in await messages(owner, welcome_id) if m["author"] and m["author"]["username"] == "aureum"]
    assert [m["content"] for m in lines] == [
        f"⬢ @mari chegou! Pioneiro nº 1 do Aureum. Seja bem-vindo(a)! Achou um bug? Manda no <#{bugs_id}>.",
        f"⬢ @zeca chegou! Seja bem-vindo(a)! Achou um bug? Manda no <#{bugs_id}>.",
    ]
    assert lines[0]["official"] == {"category": "boas-vindas"} and lines[0]["author"]["is_official"] is True


async def test_no_welcome_outside_the_official_server_or_without_a_channel(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    owner = await make_user(client, "owner")
    server, welcome_id, _ = await official_server(owner)
    await switch(bot.WELCOME)  # on, but no channel
    guest = await make_user(client, "guest")
    await join(guest, server, owner)
    assert all(m["author"]["username"] != "aureum" for m in await messages(owner, welcome_id))

    # A channel of a server that isn't official can't be set at all.
    other = await make_server(owner, name="Friends")
    assert await cli.bot_set_channel(bot.WELCOME, uuid.UUID(text_channel(other))) == 1
    # Off: nothing even with the channel set.
    await switch(bot.WELCOME, on=False, boas_vindas=welcome_id)
    late = await make_user(client, "late")
    await join(late, server, owner)
    assert all(m["author"]["username"] != "aureum" for m in await messages(owner, welcome_id))


async def test_bot_say_posts_in_the_official_server(client: AsyncClient, aureum, capsys) -> None:  # noqa: ANN001
    owner = await make_user(client, "owner")
    _, welcome_id, _ = await official_server(owner)
    assert await cli.bot_say("**Manutenção** às 22h", uuid.UUID(welcome_id)) == 0
    [line] = [m for m in await messages(owner, welcome_id) if m["author"]["username"] == "aureum"]
    assert line["content"] == "**Manutenção** às 22h"
    # Without --canal it needs the avisos channel.
    assert await cli.bot_say("oi", None) == 2
    await switch(avisos=welcome_id)
    assert await cli.bot_say("oi", None) == 0


# --- Bugs ----------------------------------------------------------------------------------


async def report(user: ApiUser, description: str = "Tela preta ao abrir a câmera\ndetalhes...") -> str:
    res = await user.client.post(
        "/api/bug-reports", headers=user.headers, data={"description": description, "app_version": "0.2.0", "os": "Windows 11"}
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def test_resolved_bug_posts_thanks_and_dms_with_the_badge_once(client: AsyncClient, aureum, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(get_settings(), "aureum_owner_username", "owner")
    owner = await make_user(client, "owner")
    server, _, bugs_id = await official_server(owner)
    await switch(bot.BUGS, "dm-bugs", "dm-insignias", bugs=bugs_id)
    hunter = await make_user(client, "hunter")
    first, second = await report(hunter), await report(hunter, "Som cortando")

    assert (await owner.patch(f"/bug-reports/{first}", {"resolved": True})).status_code == 200
    assert (await owner.patch(f"/bug-reports/{second}", {"resolved": True})).status_code == 200
    public = [m["content"] for m in await messages(owner, bugs_id) if m["author"]["username"] == "aureum"]
    assert public == [
        "✅ **Bug corrigido:** Tela preta ao abrir a câmera. Valeu, @hunter! Atualizem o app e testem, por favor.",
        "✅ **Bug corrigido:** Som cortando. Valeu, @hunter! Atualizem o app e testem, por favor.",
    ]
    assert await dm_texts(hunter) == [
        'Seu bug "Tela preta ao abrir a câmera" foi corrigido. Atualize o app e teste, por favor. Valeu! E você ganhou a insígnia **Caçador de bugs**.',
        'Seu bug "Som cortando" foi corrigido. Atualize o app e teste, por favor. Valeu!',
    ]
    # Reopened and resolved again: no repeat.
    await owner.patch(f"/bug-reports/{first}", {"resolved": False})
    await owner.patch(f"/bug-reports/{first}", {"resolved": True})
    assert len(await dm_texts(hunter)) == 2


async def test_confirmed_bug_says_we_are_on_it_once(client: AsyncClient, aureum, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(get_settings(), "aureum_owner_username", "owner")
    owner = await make_user(client, "owner")
    _, _, bugs_id = await official_server(owner)
    await switch(bot.BUGS, "dm-bugs", bugs=bugs_id)
    reporter = await make_user(client, "reporter")
    report_id = await report(reporter)

    res = await owner.patch(f"/bug-reports/{report_id}", {"confirmed": True})
    assert res.status_code == 200 and res.json()["confirmed_at"] and res.json()["resolved_at"] is None
    public = [m["content"] for m in await messages(owner, bugs_id) if m["author"]["username"] == "aureum"]
    assert public == ["🔧 **Bug encontrado:** Tela preta ao abrir a câmera. Já estamos corrigindo. Valeu pelo aviso, @reporter!"]
    assert await dm_texts(reporter) == [
        'Confirmamos o bug "Tela preta ao abrir a câmera" que você reportou. Já estamos corrigindo e te avisamos aqui quando sair a correção.'
    ]
    # Confirming again changes nothing; resolving later keeps it confirmed and adds the fix DM.
    await owner.patch(f"/bug-reports/{report_id}", {"confirmed": True})
    res = await owner.patch(f"/bug-reports/{report_id}", {"resolved": True})
    assert res.json()["confirmed_at"] and res.json()["resolved_at"]
    assert len(await dm_texts(reporter)) == 2


async def test_dismissed_bug_grants_nothing(client: AsyncClient, aureum, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(get_settings(), "aureum_owner_username", "owner")
    owner = await make_user(client, "owner")
    _, _, bugs_id = await official_server(owner)
    await switch(bot.BUGS, "dm-bugs", "dm-insignias", bugs=bugs_id)
    reporter = await make_user(client, "reporter")
    report_id = await report(reporter)

    res = await owner.patch(f"/bug-reports/{report_id}", {"dismissed": True})
    assert res.status_code == 200 and res.json()["dismissed_at"] and res.json()["resolved_at"] is None
    assert (await reporter.get("/users/me")).json()["badges"] == []
    assert all(m["author"]["username"] != "aureum" for m in await messages(owner, bugs_id))
    assert await official_dm(reporter) is None


# --- Official DM ---------------------------------------------------------------------------


async def test_badge_dm_and_a_category_turned_off(client: AsyncClient, aureum, capsys) -> None:  # noqa: ANN001
    await switch("dm-insignias")
    mari = await make_user(client, "mari")
    assert await cli.badges("grant", "mari", "bug_hunter") == 0
    dm = await official_dm(mari)
    assert dm is not None and dm["official"] is True
    [line] = await messages(mari, dm["id"])
    assert line["content"] == "Você ganhou a insígnia **Caçador de bugs**!"
    assert line["official"] == {"category": "insignias", "badge": "bug_hunter"}

    zeca = await make_user(client, "zeca")
    assert (await zeca.patch("/users/me/settings", {"official_dm": {"insignias": False}})).json()["official_dm"] == {"insignias": False}
    assert await cli.badges("grant", "zeca", "bug_hunter") == 0
    assert await official_dm(zeca) is None
    # Security can't be turned off through the API.
    assert (await zeca.patch("/users/me/settings", {"official_dm": {"seguranca": False}})).status_code == 422


async def test_security_notices_always_arrive(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    await switch("dm-seguranca")
    mari = await make_user(client, "mari")
    async with SessionLocal() as session:  # even with the category forced off
        session.add(UserSettings(user_id=uuid.UUID(mari.id), official_dm={"seguranca": False}))
        await session.commit()
    res = await mari.post("/auth/change-password", {"current_password": PASSWORD, "new_password": "another-pass-1"})
    assert res.status_code == 200, res.text
    # The old token stopped working with the change: read with the new one.
    mari = ApiUser(client, res.json()["access_token"], {"id": mari.id, "email": mari.email})
    [notice] = await dm_texts(mari)
    assert notice.startswith("**Sua senha foi alterada** em ") and notice.endswith("Não foi você? Troque sua senha agora.")


async def login(client: AsyncClient, email: str, device: str | None, os: str = "Windows 11") -> dict[str, Any]:
    body: dict[str, Any] = {"email": email, "password": PASSWORD}
    if device:
        body |= {"device_id": device, "os": os}
    res = await client.post("/api/auth/login", json=body)
    assert res.status_code == 200, res.text
    return res.json()


async def test_new_sign_in_only_from_a_new_install(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    await switch("dm-seguranca")
    mari = await make_user(client, "mari")
    await login(client, mari.email, "install-A-1234")  # the first install known: never "new"
    await login(client, mari.email, "install-A-1234")
    await login(client, mari.email, None)  # an older app sends no id
    refreshed = await client.post("/api/auth/refresh", json={"refresh_token": (await login(client, mari.email, None))["refresh_token"], "device_id": "install-B-5678"})
    assert refreshed.status_code == 200  # recorded, never reported (already signed in there)
    assert await dm_texts(mari) == []

    await login(client, mari.email, "install-C-9999", "Windows 10")
    [notice] = await dm_texts(mari)
    assert "**Novo login na sua conta** em " in notice and ", no Windows 10." in notice


async def test_e_mail_change_notice(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    from tests.helpers import last_code

    await switch("dm-seguranca")
    mari = await make_user(client, "mari")
    assert (await mari.post("/users/me/email", {"email": "nova@example.com", "password": PASSWORD})).status_code == 202
    assert (await mari.post("/users/me/email/confirm", {"code": await last_code("nova@example.com")})).status_code == 200
    [notice] = await dm_texts(mari)
    assert notice.startswith("**O e-mail da sua conta foi alterado** para n") and "@example.com" in notice


async def test_invite_notice_when_the_guest_confirms(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    await switch("dm-convites")
    host = await make_user(client, "host")
    code = await make_account_invite(owner_id=uuid.UUID(host.id))
    tokens = await sign_up(client, "guest", code)
    assert await dm_texts(host) == []  # not before the e-mail is confirmed
    assert (await verify(client, tokens)).status_code == 200
    assert await dm_texts(host) == ["@guest entrou com o seu convite!"]


async def test_official_dm_is_read_only_even_through_the_api(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    await switch("dm-insignias")
    mari = await make_user(client, "mari")
    await cli.badges("grant", "mari", "bug_hunter")
    dm = await official_dm(mari)
    assert dm is not None
    res = await mari.post(f"/channels/{dm['id']}/messages", {"content": "oi"})
    assert (res.status_code, res.json()["detail"]) == (403, "Esta conversa é só de leitura. Atualize o app.")
    upload = await client.post(f"/api/channels/{dm['id']}/attachments", headers=mari.headers, files={"file": ("a.txt", b"x")})
    assert upload.status_code == 403
    assert (await mari.post(f"/channels/{dm['id']}/call")).status_code == 403


async def test_nobody_else_gets_the_official_look(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    ana, bia = await make_user(client, "ana"), await make_user(client, "bia")
    await ana.post("/friends/requests", {"username": "bia"})
    await bia.post(f"/friends/{ana.id}/accept")
    dm = (await ana.post("/dms", {"user_id": bia.id})).json()
    assert dm["official"] is False
    sent = await ana.post(f"/channels/{dm['id']}/messages", {"content": "sou o aureum", "official": {"category": "seguranca"}})
    assert sent.status_code == 201 and sent.json()["official"] is None
    # An account named after the bot but not made official by the CLI is never the bot.
    async with SessionLocal() as session:
        await session.execute(update(User).where(User.username == "aureum").values(is_official=False))
        await session.commit()
        assert await bot.bot_user(session) is None


@pytest.mark.parametrize("name", ["Aureum", "AUREUM", "Aure um", "Auréum", "aur3um", "Aureum Oficial", "Suporte_Aureum", "Aureun"])
async def test_names_like_aureum_are_refused(client: AsyncClient, name: str) -> None:
    mari = await make_user(client, "mari")
    res = await mari.patch("/users/me", {"display_name": name})
    assert res.status_code == 422, name
    assert res.json()["detail"] == "Esse nome é parecido demais com o do Aureum. Escolha outro."


async def test_ordinary_names_and_sign_up_names(client: AsyncClient) -> None:
    mari = await make_user(client, "mari")
    for name in ("Mariana", "Aurora", "Laura Eum"):
        assert (await mari.patch("/users/me", {"display_name": name})).status_code == 200, name
    # The rule is about the display name, the one shown big next to messages; an @ like
    # "aureum_fan" stays fine (only exact reserved names are refused, see test_accounts).
    res = await client.post(
        "/api/auth/register",
        json={"username": "fa_do_app", "email": "fa@example.com", "password": PASSWORD, "display_name": "Auréum", "invite_code": await make_account_invite()},
    )
    assert (res.status_code, res.json()["detail"]) == (422, "Esse nome é parecido demais com o do Aureum. Escolha outro.")


async def test_the_bot_takes_no_friends_no_blocks_no_invites(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    mari = await make_user(client, "mari")
    res = await mari.post("/friends/requests", {"username": "aureum"})
    assert (res.status_code, res.json()["detail"]) == (403, "A conta oficial do Aureum não aceita pedidos de amizade.")
    res = await mari.post(f"/friends/{aureum}/block")
    assert res.status_code == 403 and "silenciar" in res.json()["detail"]

    server = await make_server(mari)
    code = (await mari.post(f"/servers/{server['id']}/invites", {})).json()["code"]
    bot_token = auth_router.token_pair(await _user(aureum)).access_token
    joined = await client.post(f"/api/invites/{code}/join", headers={"Authorization": f"Bearer {bot_token}"})
    assert joined.status_code == 403


async def _user(user_id: uuid.UUID) -> User:
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        assert user is not None
        return user


# --- Broadcast -----------------------------------------------------------------------------


async def test_broadcast_counts_confirms_dedups_and_resumes(client: AsyncClient, aureum, capsys, monkeypatch) -> None:  # noqa: ANN001
    users = [await make_user(client, n) for n in ("ana", "bia", "caio")]
    await make_user(client, "pending", confirmed=False)  # unconfirmed: left out
    await users[2].patch("/users/me/settings", {"official_dm": {"novidades": False}})
    text = "Versão 0.2.0-beta.3 saiu!"

    monkeypatch.setattr("builtins.input", lambda _: "n")
    assert await cli.bot_broadcast("novidades", text, yes=False) == 1
    assert "2 pessoa(s)" in capsys.readouterr().out
    assert await cli.bot_broadcast("novidades", text, yes=True) == 0

    # Interrupted: one DM went out, the other was taken but never delivered.
    assert await broadcast.send_due(limit=1) == 1
    async with SessionLocal() as session:
        await session.execute(update(BotOutbox).values(sent_at=BotOutbox.created_at))
        await session.commit()
    capsys.readouterr()
    assert await cli.bot_broadcast("novidades", text, yes=True) == 0  # the same command picks up
    assert "1 pessoa(s)" in capsys.readouterr().out
    while await broadcast.send_due():
        pass
    assert [await dm_texts(u) for u in users] == [[text], [text], []]

    # Nothing left: running it again sends nobody anything.
    assert await cli.bot_broadcast("novidades", text, yes=True) == 0
    assert "0 pessoa(s)" in capsys.readouterr().out
    assert [len(await dm_texts(u)) for u in users] == [1, 1, 0]


# --- Release announcements -----------------------------------------------------------------

NOW = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)


def release(tag: str, days_ago: float, body: str = "", draft: bool = False) -> dict[str, Any]:
    published = (NOW - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")
    return {"tag_name": tag, "draft": draft, "published_at": None if draft else published, "body": body}


def test_only_the_newest_recent_published_release_counts() -> None:
    assert releases.newest([release("v0.2.0-beta.2", 10), release("v0.2.0-beta.1", 30)], NOW) is None
    found = releases.newest([release("v0.3.0", 0, draft=True), release("v0.2.0-beta.4", 0.1), release("v0.2.0-beta.3", 1)], NOW)
    assert found is not None and found["tag_name"] == "v0.2.0-beta.4"


def test_release_notes_read_like_a_chat_message() -> None:
    body = "- **Ícone novo:** o Aureum ganhou o logo\n  oficial na bandeja.\r\n- Overlay corrigido.\n\n### Para quem testa\nReinicie o app."
    assert releases.notes(body) == "• **Ícone novo:** o Aureum ganhou o logo oficial na bandeja.\n• Overlay corrigido.\n\n**Para quem testa**\nReinicie o app."
    assert releases.notes(None) == ""
    assert len(releases.notes("x" * 5000)) == releases.NOTES_MAX


async def test_new_release_announced_once_in_avisos_and_by_dm(client: AsyncClient, aureum, monkeypatch) -> None:  # noqa: ANN001
    owner = await make_user(client, "owner")
    _, avisos_id, _ = await official_server(owner)
    reader, quiet = await make_user(client, "reader"), await make_user(client, "quiet")
    await quiet.patch("/users/me/settings", {"official_dm": {"novidades": False}})

    async def fetch() -> list[dict[str, Any]]:
        return [release("v0.2.0-beta.4", 0.5, "- Microfone corrigido.")]

    monkeypatch.setattr(releases, "fetch", fetch)
    await switch(avisos=avisos_id)
    assert await releases.check(NOW) is False  # the action starts off: nothing, and it isn't spent
    await switch(bot.NOTICES, bot.RELEASES)
    assert await releases.check(NOW) is True
    assert await releases.check(NOW) is False  # once per tag
    while await broadcast.send_due():
        pass

    expected = "⬢ **Saiu a versão 0.2.0-beta.4 do Aureum!** O app se atualiza sozinho: é só fechar e abrir de novo.\n\n• Microfone corrigido."
    posted = [m for m in await messages(owner, avisos_id) if m["author"]["username"] == "aureum"]
    assert [m["content"] for m in posted] == [expected] and posted[0]["official"] == {"category": "novidades"}
    assert await dm_texts(reader) == [expected]
    assert await dm_texts(quiet) == []


# --- Presence ------------------------------------------------------------------------------


async def test_the_bot_always_shows_online(client: AsyncClient, aureum) -> None:  # noqa: ANN001
    await switch("dm-insignias")
    mari = await make_user(client, "mari")
    await cli.badges("grant", "mari", "bug_hunter")
    dm = await official_dm(mari)
    assert dm is not None
    statuses = {m["user"]["username"]: m["status"] for m in dm["members"]}
    assert statuses == {"mari": "offline", "aureum": "online"}  # nobody is connected over the WebSocket


async def test_cli_status_and_switches(client: AsyncClient, aureum, capsys) -> None:  # noqa: ANN001
    assert await cli.bot_switch(bot.WELCOME, True) == 0
    assert "Sem canal configurado" in capsys.readouterr().out
    assert await cli.bot_status() == 0
    out = capsys.readouterr().out
    assert "Bot account @aureum: ok" in out and "boas-vindas    ligada  (sem canal: não roda)" in out
    assert "dm-seguranca   desligada" in out
