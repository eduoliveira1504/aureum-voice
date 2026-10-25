import pytest
from httpx import AsyncClient

from app import badges, cli
from app.config import get_settings
from app.db import SessionLocal
from tests.helpers import last_code, make_server, make_user, text_channel
from tests.test_auth import invited
from tests.test_bug_reports import report


@pytest.fixture
def beta(monkeypatch: pytest.MonkeyPatch):  # noqa: ANN201
    """Turns the beta on with `owner` as the app owner (AUREUM_BETA / AUREUM_OWNER_USERNAME)."""

    def configure(on: bool = True, owner: str | None = "edu") -> None:
        monkeypatch.setattr(get_settings(), "aureum_beta", on)
        monkeypatch.setattr(get_settings(), "aureum_owner_username", owner)

    return configure


def held(user_json: dict) -> list[tuple[str, int | None]]:
    return [(b["key"], b["number"]) for b in user_json["badges"]]


async def me(client: AsyncClient, tokens: dict) -> dict:
    res = await client.get("/api/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    return res.json()


async def test_catalog(client: AsyncClient) -> None:
    alice = await make_user(client, "alice")
    catalog = {b["key"]: b for b in (await alice.get("/badges")).json()}
    assert set(catalog) == {"founder", "pioneer", "beta_tester", "bug_hunter"}
    assert (catalog["founder"]["name"], catalog["founder"]["rarity"]) == ("Fundador", "mitica")
    assert catalog["pioneer"]["numbered"] is True
    assert (catalog["pioneer"]["exclusive_beta"], catalog["bug_hunter"]["exclusive_beta"]) == (True, False)
    beta_tester = catalog["beta_tester"]
    assert (beta_tester["name"], beta_tester["rarity"], beta_tester["numbered"], beta_tester["exclusive_beta"]) == (
        "Beta Tester", "lendaria", False, True,
    )
    assert catalog["pioneer"]["description"] == "Um dos 20 primeiros a chegar no Aureum."
    assert catalog["bug_hunter"]["rarity"] == "rara"
    # Ties within a rarity next to a name: Fundador before Pioneiro.
    assert catalog["founder"]["priority"] < catalog["pioneer"]["priority"] < catalog["bug_hunter"]["priority"]
    assert all(b["icon_svg"].startswith("<svg") and b["icon_svg_small"].startswith("<svg") for b in catalog.values())
    assert (await client.get("/api/badges")).status_code == 401


async def signed_up(client: AsyncClient, username: str, confirm: bool = True) -> dict:
    """Signs up with an account invite and (by default) types the e-mailed code; the tokens."""
    email = f"{username.lower()}@example.com"
    res = await invited(client, username=username, email=email)
    assert res.status_code == 201, res.text
    tokens = res.json()
    if confirm:
        ok = await client.post(
            "/api/auth/verify-email", json={"code": await last_code(email)},
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        assert ok.status_code == 200, ok.text
    return tokens


async def test_beta_badge_comes_numbered_with_the_confirmed_e_mail(client: AsyncClient, beta) -> None:  # noqa: ANN001
    beta(owner="Edu")
    edu_tokens = await signed_up(client, "Edu", confirm=False)
    assert held(await me(client, edu_tokens)) == [("founder", None)]  # Founder at sign-up, no number yet
    ana_tokens = await signed_up(client, "ana")
    ana = await me(client, ana_tokens)
    assert held(ana) == [("pioneer", 1), ("beta_tester", None)]
    assert ana["badges"][0]["granted_at"]

    # Others see it too, e.g. in a server's member list.
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    code = (await owner.post(f"/servers/{server['id']}/invites", {})).json()["code"]
    auth = {"Authorization": f"Bearer {ana_tokens['access_token']}"}
    assert (await client.post(f"/api/invites/{code}/join", headers=auth)).status_code == 200
    members = {m["user"]["username"]: m["user"] for m in (await owner.get(f"/servers/{server['id']}")).json()["members"]}
    assert held(members["ana"]) == [("pioneer", 1), ("beta_tester", None)]


async def test_no_beta_badges_after_the_beta(client: AsyncClient, beta) -> None:  # noqa: ANN001
    beta(on=False)
    tokens = await signed_up(client, "edu")
    assert held(await me(client, tokens)) == []
    # Not even by hand: mythic badges and Beta Tester are beta-only.
    assert await cli.badges("grant", "edu", "founder") == 1
    assert await cli.badges("grant", "edu", "beta_tester") == 1
    assert await cli.badges("grant", "edu", "bug_hunter") == 0


async def test_founder_at_startup_when_the_owner_exists(client: AsyncClient, beta) -> None:  # noqa: ANN001
    edu = await make_user(client, "edu")  # created before the owner was configured
    beta()
    async with SessionLocal() as session:
        await badges.grant_founder_if_due(session)
        await badges.grant_founder_if_due(session)  # idempotent
    assert held((await edu.get("/users/me")).json()) == [("founder", None)]


async def test_resolved_reports_make_bug_hunters(client: AsyncClient, beta) -> None:  # noqa: ANN001
    beta(on=False, owner="edu")
    edu = await make_user(client, "edu")
    ana = await make_user(client, "ana")
    first = (await report(ana)).json()["id"]
    second = (await report(ana)).json()["id"]

    assert (await edu.patch(f"/bug-reports/{first}", {"resolved": True})).status_code == 200
    assert held((await ana.get("/users/me")).json()) == [("bug_hunter", None)]
    # Reopening keeps it, and another resolved report doesn't grant it twice.
    await edu.patch(f"/bug-reports/{first}", {"resolved": False})
    await edu.patch(f"/bug-reports/{second}", {"resolved": True})
    assert held((await ana.get("/users/me")).json()) == [("bug_hunter", None)]


async def test_cli_grants_and_revokes(client: AsyncClient, beta) -> None:  # noqa: ANN001
    beta()
    user = await make_user(client, "ana")
    server = await make_server(user)
    assert await cli.badges("grant", "ana", "pioneer") == 0
    assert await cli.badges("grant", "ana", "bug_hunter") == 0
    assert held((await user.get("/users/me")).json()) == [("pioneer", 1), ("bug_hunter", None)]
    assert await cli.badges("revoke", "ana", "pioneer") == 0
    assert held((await user.get("/users/me")).json()) == [("bug_hunter", None)]
    assert await cli.badges("grant", "ana", "admin") == 2
    assert await cli.badges("grant", "nobody", "pioneer") == 1

    # Message authors carry them as well.
    res = await user.post(f"/channels/{text_channel(server)}/messages", {"content": "oi"})
    assert held(res.json()["author"]) == [("bug_hunter", None)]


async def test_owner_name_may_be_written_with_an_at(client: AsyncClient, beta) -> None:  # noqa: ANN001
    beta(owner=" @Edu ")
    edu = await make_user(client, "edu")
    assert (await edu.get("/users/me")).json()["is_app_owner"] is True
    async with SessionLocal() as session:
        await badges.grant_founder_if_due(session)
    assert held((await edu.get("/users/me")).json()) == [("founder", None)]
