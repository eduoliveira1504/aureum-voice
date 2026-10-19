"""Block 2.10: e-mail codes, account invites, the numbered beta badge, official accounts and
servers, password changes and resets, the e-mail queue and the invite page."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app import cli, mail, onboarding
from app.routers import auth as auth_router
from app.config import get_settings
from app.db import SessionLocal
from app.mail.providers import get_provider
from app.models import AccountInvite, EmailCode, OutboxEmail, User
from tests.helpers import PASSWORD, inbox, last_code, make_account_invite, make_server, make_user
from tests.test_auth import USER, bearer, register
from tests.test_badges import held, me


@pytest.fixture(autouse=True)
def many_sign_ups(monkeypatch: pytest.MonkeyPatch) -> None:
    """These tests sign up more than 5 accounts from one IP (that limit is tested in test_auth)."""
    monkeypatch.setattr(auth_router, "REGISTER_PER_IP", (100, 3600))


@pytest.fixture
def beta(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "aureum_beta", True)


async def sign_up(client: AsyncClient, username: str = "mari", code: str | None = None) -> dict:
    res = await register(
        client, username=username, email=f"{username}@example.com", invite_code=code or await make_account_invite()
    )
    assert res.status_code == 201, res.text
    return {**res.json(), "email": f"{username}@example.com"}


async def verify(client: AsyncClient, tokens: dict, code: str | None = None):  # noqa: ANN201
    code = code or await last_code(tokens["email"])
    return await client.post("/api/auth/verify-email", json={"code": code}, headers=bearer(tokens["access_token"]))


async def expire(user_email: str, **changes: object) -> None:
    async with SessionLocal() as session:
        user_id = await session.scalar(select(User.id).where(User.email == user_email))
        await session.execute(update(EmailCode).where(EmailCode.user_id == user_id).values(**changes))
        await session.commit()


# --- Confirmation code --------------------------------------------------------


async def test_sign_up_e_mails_a_code_and_confirming_hands_out_everything(client: AsyncClient, beta) -> None:  # noqa: ANN001
    tokens = await sign_up(client)
    [code_mail] = await inbox()
    assert code_mail.subject.startswith("Seu código do Aureum: ")
    assert "Digite este código no Aureum" in code_mail.html and "https://aureum.test/static/email/logo.png" in code_mail.html
    assert "15 minutos" in code_mail.text
    unconfirmed = await me(client, tokens)
    assert unconfirmed["email_verified"] is False and held(unconfirmed) == []

    res = await verify(client, tokens)
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["pioneer_number"], body["invites"], body["user"]["email_verified"]) == (1, 3, True)

    welcome = (await inbox())[-1]
    assert welcome.to == "mari@example.com"
    assert welcome.subject == "Boas-vindas ao Aureum! Sua insígnia Pioneiro nº 1"
    assert "Baixar o Aureum" in welcome.html and "Aureum-Setup.exe" in welcome.html
    assert "pioneiro.png" in welcome.html and "3 convites" in welcome.text

    again = await verify(client, tokens, "000000")
    assert again.status_code == 409  # already confirmed


async def test_wrong_codes_run_out_after_five_tries(client: AsyncClient) -> None:
    tokens = await sign_up(client)
    right = await last_code(tokens["email"])
    wrong = "111111" if right != "111111" else "222222"
    for _ in range(4):
        assert (await verify(client, tokens, wrong)).json()["detail"] == "Wrong code"
    assert (await verify(client, tokens, wrong)).json()["detail"] == "Too many wrong tries; ask for a new code"
    assert (await verify(client, tokens, right)).status_code == 400  # even the right one, now


async def test_codes_expire_after_fifteen_minutes(client: AsyncClient) -> None:
    tokens = await sign_up(client)
    code = await last_code(tokens["email"])
    await expire(tokens["email"], expires_at=datetime.now(UTC) - timedelta(seconds=1))
    res = await verify(client, tokens, code)
    assert (res.status_code, res.json()["detail"]) == (400, "This code has expired; ask for a new one")


async def test_resend_waits_a_minute_and_replaces_the_code(client: AsyncClient) -> None:
    tokens = await sign_up(client)
    first = await last_code(tokens["email"])
    early = await client.post("/api/auth/resend-code", headers=bearer(tokens["access_token"]))
    assert early.status_code == 429 and 0 < int(early.headers["retry-after"]) <= 60

    await expire(tokens["email"], sent_at=datetime.now(UTC) - timedelta(seconds=61))
    assert (await client.post("/api/auth/resend-code", headers=bearer(tokens["access_token"]))).status_code == 204
    second = await last_code(tokens["email"])
    if second != first:
        assert (await verify(client, tokens, first)).status_code == 400
    assert (await verify(client, tokens, second)).status_code == 200


async def test_fixing_the_address_before_confirming(client: AsyncClient) -> None:
    tokens = await sign_up(client)
    await make_user(client, "taken")
    auth = bearer(tokens["access_token"])
    assert (await client.patch("/api/auth/pending-email", json={"email": "taken@example.com"}, headers=auth)).status_code == 409
    res = await client.patch("/api/auth/pending-email", json={"email": "Mari.Certo@example.com"}, headers=auth)
    assert res.status_code == 200 and res.json()["email"] == "mari.certo@example.com"
    assert (await verify(client, {**tokens, "email": "mari.certo@example.com"})).status_code == 200


async def test_unconfirmed_accounts_sign_in_but_create_no_servers(client: AsyncClient) -> None:
    tokens = await sign_up(client)
    login = await client.post("/api/auth/login", json={"email": "mari@example.com", "password": USER["password"]})
    assert login.status_code == 200
    res = await client.post("/api/servers", json={"name": "x"}, headers=bearer(login.json()["access_token"]))
    assert (res.status_code, res.json()["detail"]) == (403, "Confirm your e-mail to create servers")
    await verify(client, tokens)
    assert (await client.post("/api/servers", json={"name": "x"}, headers=bearer(tokens["access_token"]))).status_code == 201


async def test_code_tries_are_limited_per_ip(client: AsyncClient) -> None:
    accounts = [await sign_up(client, f"user{i}") for i in range(5)]
    statuses = [
        (await verify(client, accounts[i % 5], "999999")).status_code for i in range(21)
    ]
    assert statuses[-1] == 429


# --- Pioneiro numbers ---------------------------------------------------------


async def test_simultaneous_confirmations_get_different_numbers(client: AsyncClient, beta) -> None:  # noqa: ANN001
    accounts = [await sign_up(client, f"pioneer{i}") for i in range(8)]
    codes = [await last_code(a["email"]) for a in accounts]
    results = await asyncio.gather(*(verify(client, a, c) for a, c in zip(accounts, codes, strict=True)))
    numbers = sorted(r.json()["pioneer_number"] for r in results)
    assert numbers == list(range(1, 9))


async def test_reserved_numbers_are_skipped_and_kept(client: AsyncClient, beta, capsys) -> None:  # noqa: ANN001
    assert await cli.create_invites(None, None, None, 2) == 0
    reserved_code = capsys.readouterr().out.split("/convite/")[1].split()[0]
    assert await cli.create_invites(None, None, None, 2) == 1  # already reserved

    first = await sign_up(client, "first")
    await verify(client, first)
    third = await sign_up(client, "third")
    assert (await verify(client, third)).json()["pioneer_number"] == 3  # 2 is kept
    second = await sign_up(client, "second", reserved_code)
    assert (await verify(client, second)).json()["pioneer_number"] == 2


async def test_numbers_are_never_reused(client: AsyncClient, beta) -> None:  # noqa: ANN001
    gone = await sign_up(client, "gone")
    await verify(client, gone)
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.username == "gone"))
        await session.delete(user)
        await session.commit()
    nxt = await sign_up(client, "next")
    assert (await verify(client, nxt)).json()["pioneer_number"] == 2
    assert await cli.create_user("late", "late@example.com", pioneer=1) == 1  # taken by the deleted account


# --- Account invites ----------------------------------------------------------


async def preview(client: AsyncClient, code: str) -> dict:
    return (await client.get(f"/api/account-invites/{code}")).json()


async def test_invite_states(client: AsyncClient) -> None:
    single = await make_account_invite()
    group = await make_account_invite(max_uses=3, expires_at=datetime.now(UTC) + timedelta(days=7))
    old = await make_account_invite(max_uses=5, expires_at=datetime.now(UTC) - timedelta(minutes=1))
    assert (await client.get("/api/account-invites/NOPE2345")).status_code == 404
    assert (await preview(client, single))["status"] == "valid"
    assert (await preview(client, group))["remaining"] == 3
    assert (await preview(client, old))["status"] == "expired"
    assert (await register(client, invite_code=old)).json()["detail"] == "This invite has expired"

    used = await sign_up(client, "aaa", single)
    await verify(client, used)
    assert (await preview(client, single))["status"] == "used"
    assert (await register(client, invite_code=single)).json()["detail"] == "This invite was already used"

    for name in ("bbb", "ccc", "ddd"):
        await verify(client, await sign_up(client, name, group))
    assert (await preview(client, group))["status"] == "exhausted"
    assert (await register(client, invite_code=group)).json()["detail"] == "This invite has no spots left"


async def test_a_spot_is_only_spent_on_confirmation(client: AsyncClient) -> None:
    group = await make_account_invite(max_uses=2)
    early = [await sign_up(client, name, group) for name in ("xxx", "yyy", "zzz")]  # nobody confirmed yet
    assert (await preview(client, group))["remaining"] == 2
    for tokens in early:  # it runs out after two, but whoever signed up before still gets in
        assert (await verify(client, tokens)).status_code == 200
    async with SessionLocal() as session:
        assert (await session.get(AccountInvite, group)).uses == 3


async def test_confirmed_users_get_three_invites_and_see_who_used_them(client: AsyncClient) -> None:
    edu = await sign_up(client, "edu")
    await verify(client, edu)
    mine = (await client.get("/api/users/me/invites", headers=bearer(edu["access_token"]))).json()
    assert [i["status"] for i in mine] == ["free"] * 3
    assert mine[0]["url"] == f"https://aureum.test/convite/{mine[0]['code']}"
    preview_json = await preview(client, mine[0]["code"])
    assert preview_json["inviter"]["username"] == "edu" and preview_json["kind"] == "single"

    ana = await sign_up(client, "ana", mine[0]["code"])
    mine = (await client.get("/api/users/me/invites", headers=bearer(edu["access_token"]))).json()
    assert (mine[0]["status"], mine[0]["used_by"]["username"]) == ("pending", "ana")
    await verify(client, ana)
    mine = (await client.get("/api/users/me/invites", headers=bearer(edu["access_token"]))).json()
    assert [i["status"] for i in mine] == ["used", "free", "free"]


# --- CLI accounts, official accounts and servers ------------------------------


async def test_cli_confirmed_account_gets_pioneer_invites_and_welcome(client: AsyncClient, beta, capsys) -> None:  # noqa: ANN001
    assert await cli.create_user("edu", "edu@example.com", confirmed=True) == 0
    out = capsys.readouterr().out
    temporary = out.split("first sign-in): ")[1].strip()
    assert "pioneer #1" in out
    assert [e.subject for e in await inbox()] == ["Boas-vindas ao Aureum! Sua insígnia Pioneiro nº 1"]
    login = await client.post("/api/auth/login", json={"email": "edu@example.com", "password": temporary})
    assert login.status_code == 200


async def test_cli_reserved_number_for_an_account(client: AsyncClient, beta, capsys) -> None:  # noqa: ANN001
    assert await cli.create_user("edu", "edu@example.com", confirmed=True, password=PASSWORD) == 0
    assert await cli.create_user("namorada", "n@example.com", pioneer=2, confirmed=True, password=PASSWORD) == 0
    assert "pioneer #2" in capsys.readouterr().out
    other = await sign_up(client, "outro")
    assert (await verify(client, other)).json()["pioneer_number"] == 3


async def test_cli_unconfirmed_account_follows_the_normal_rules(client: AsyncClient, beta) -> None:  # noqa: ANN001
    assert await cli.create_user("ana", "ana@example.com", password=PASSWORD) == 0
    login = (await client.post("/api/auth/login", json={"email": "ana@example.com", "password": PASSWORD})).json()
    res = await verify(client, {**login, "email": "ana@example.com"})
    assert res.json()["pioneer_number"] == 1 and res.json()["invites"] == 3


async def test_official_accounts_get_no_pioneer_nor_invites(client: AsyncClient, beta, capsys) -> None:  # noqa: ANN001
    assert await cli.create_user("aureum", "oficial@aureum.app", official=True, confirmed=True, password=PASSWORD) == 0
    login = (await client.post("/api/auth/login", json={"email": "oficial@aureum.app", "password": PASSWORD})).json()
    profile = await me(client, login)
    assert (profile["is_official"], held(profile)) == (True, [])
    assert (await client.get("/api/users/me/invites", headers=bearer(login["access_token"]))).json() == []
    assert await inbox() == []  # no welcome either
    nxt = await sign_up(client, "ana")
    assert (await verify(client, nxt)).json()["pioneer_number"] == 1


async def test_confirmed_users_join_the_official_server_and_may_leave(client: AsyncClient) -> None:
    owner = await make_user(client, "edu")
    server = await make_server(owner, name="Beta")
    assert await cli.set_official(server["id"], True) == 0

    tokens = await sign_up(client)
    await verify(client, tokens)
    auth = bearer(tokens["access_token"])
    assert [s["id"] for s in (await client.get("/api/servers", headers=auth)).json()] == [server["id"]]
    assert "Você já está no servidor do beta" in (await inbox())[-1].text
    assert (await client.delete(f"/api/servers/{server['id']}/members/me", headers=auth)).status_code == 204


async def test_banned_users_do_not_join_the_official_server(client: AsyncClient) -> None:
    owner = await make_user(client, "edu")
    server = await make_server(owner, name="Beta")
    await cli.set_official(server["id"], True)
    banned = await make_user(client, "banned", confirmed=False)
    assert (await owner.put(f"/servers/{server['id']}/bans/{banned.id}", {})).status_code == 200
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.username == "banned"))
        result = await onboarding.confirm(session, user)
        await session.commit()
    assert result.joined == []
    members = {m["user"]["username"] for m in (await owner.get(f"/servers/{server['id']}")).json()["members"]}
    assert members == {"edu"}


# --- Passwords ----------------------------------------------------------------


async def test_temporary_password_must_be_replaced_first(client: AsyncClient, capsys) -> None:
    assert await cli.create_user("ana", "ana@example.com", confirmed=True) == 0
    temporary = capsys.readouterr().out.split("first sign-in): ")[1].strip()
    tokens = (await client.post("/api/auth/login", json={"email": "ana@example.com", "password": temporary})).json()
    auth = bearer(tokens["access_token"])

    profile = (await client.get("/api/users/me", headers=auth)).json()
    assert profile["must_change_password"] is True
    blocked = await client.get("/api/servers", headers=auth)
    assert (blocked.status_code, blocked.json()["detail"]) == (403, "Password change required")

    res = await client.post("/api/auth/change-password", json={"new_password": "brand-new-pass-1"}, headers=auth)
    assert res.status_code == 200
    fresh = bearer(res.json()["access_token"])
    assert (await client.get("/api/servers", headers=fresh)).status_code == 200
    assert (await client.get("/api/users/me", headers=auth)).status_code == 401  # old session ended
    assert (await client.get("/api/users/me", headers=fresh)).json()["must_change_password"] is False


async def test_changing_the_password_ends_other_sessions_and_warns(client: AsyncClient) -> None:
    user = await make_user(client, "ana")
    other_device = (await client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})).json()
    wrong = await user.post("/auth/change-password", {"current_password": "nope-nope", "new_password": "brand-new-pass-1"})
    assert wrong.status_code == 403
    res = await user.post("/auth/change-password", {"current_password": PASSWORD, "new_password": "brand-new-pass-1"})
    assert res.status_code == 200
    assert (await client.get("/api/users/me", headers=bearer(other_device["access_token"]))).status_code == 401
    assert (await client.post("/api/auth/refresh", json={"refresh_token": other_device["refresh_token"]})).status_code == 401
    assert (await client.get("/api/users/me", headers=bearer(res.json()["access_token"]))).status_code == 200
    [notice] = await inbox()
    assert (notice.to, notice.subject) == (user.email, "Sua senha foi trocada")


async def test_forgot_password_reveals_nothing_and_resets_with_the_code(client: AsyncClient) -> None:
    user = await make_user(client, "ana")
    old = (await client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})).json()
    known = await client.post("/api/auth/forgot-password", json={"email": user.email})
    unknown = await client.post("/api/auth/forgot-password", json={"email": "ghost@example.com"})
    assert (known.status_code, known.json()) == (unknown.status_code, unknown.json()) == (202, {"ok": True})
    assert [e.to for e in await inbox()] == [user.email]

    code = await last_code(user.email)
    bad = await client.post("/api/auth/reset-password", json={"email": "ghost@example.com", "code": code, "new_password": "brand-new-pass-1"})
    assert bad.status_code == 400
    res = await client.post("/api/auth/reset-password", json={"email": user.email, "code": code, "new_password": "brand-new-pass-1"})
    assert res.status_code == 200
    assert (await client.get("/api/users/me", headers=bearer(old["access_token"]))).status_code == 401
    assert (await client.post("/api/auth/login", json={"email": user.email, "password": "brand-new-pass-1"})).status_code == 200
    assert (await inbox())[-1].subject == "Sua senha foi trocada"
    again = await client.post("/api/auth/reset-password", json={"email": user.email, "code": code, "new_password": "other-pass-123"})
    assert again.status_code == 400  # a code works once


# --- Changing the e-mail ------------------------------------------------------


async def test_changing_the_e_mail_confirms_the_new_one_and_warns_the_old(client: AsyncClient) -> None:
    user = await make_user(client, "ana")
    assert (await user.post("/users/me/email", {"email": "novo@example.com", "password": "wrong-pass"})).status_code == 403
    assert (await user.post("/users/me/email", {"email": "novo@example.com", "password": PASSWORD})).status_code == 202
    code = await last_code("novo@example.com")
    assert (await user.get("/users/me")).json()["email"] == user.email  # not yet

    res = await user.post("/users/me/email/confirm", {"code": code})
    assert res.status_code == 200 and res.json()["email"] == "novo@example.com"
    notice = (await inbox())[-1]
    assert (notice.to, notice.subject) == (user.email, "O e-mail da sua conta foi trocado")
    assert "no***@example.com" in notice.text and "novo@example.com" not in notice.text


# --- E-mail queue -------------------------------------------------------------


async def test_failed_e_mails_are_retried_then_given_up_without_secrets(client: AsyncClient) -> None:
    provider = get_provider()
    provider.fail_next = 1  # type: ignore[attr-defined]
    await sign_up(client)
    assert await inbox() == []
    async with SessionLocal() as session:
        row = await session.scalar(select(OutboxEmail))
        assert row is not None and row.attempts == 1 and row.next_attempt_at > datetime.now(UTC)
        row.next_attempt_at = datetime.now(UTC)
        await session.commit()
    assert len(await inbox()) == 1  # second try went out, row deleted
    async with SessionLocal() as session:
        assert await session.scalar(select(OutboxEmail)) is None

        provider.fail_next = 10  # type: ignore[attr-defined]
        mail.enqueue(session, "someone@example.com", "code_verify", codigo="123456", nome="X")
        await session.commit()
    for _ in range(mail.MAX_ATTEMPTS):
        async with SessionLocal() as session:
            await session.execute(update(OutboxEmail).values(next_attempt_at=datetime.now(UTC)))
            await session.commit()
        await mail.send_due()
    async with SessionLocal() as session:
        row = await session.scalar(select(OutboxEmail))
        assert row is not None and row.failed_at is not None
        assert (row.params, row.to_address, row.template) == ({}, "so***@example.com", "code_verify")
        assert "simulated failure" in (row.last_error or "")


# --- Invite page --------------------------------------------------------------


async def test_invite_page_is_public_and_locked_down(client: AsyncClient) -> None:
    res = await client.get("/convite/ab12cd34")
    assert res.status_code == 200
    assert 'data-code="AB12CD34"' in res.text
    assert "script-src 'self'" in res.headers["content-security-policy"]
    hostile = await client.get('/convite/"><script>x')
    assert "<script>x" not in hostile.text
    assert (await client.get("/api/app/latest-release")).json()["version"] == "1.0.0"
    assert (await client.get("/static/email/logo.png")).status_code == 200
    assert (await client.get("/static/email/pioneiro.png")).status_code == 200
