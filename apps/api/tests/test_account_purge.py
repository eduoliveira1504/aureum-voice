"""Block 4.2.2: `accounts purge` cleans up fake accounts, listing them first."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app import cli
from app.db import SessionLocal, engine
from app.models import Message
from tests.helpers import make_server, make_user, text_channel
from tests.test_account_deletion import exists


async def age(username: str, days: int) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE users SET created_at = now() - make_interval(days => :d) WHERE username = :u"), {"d": days, "u": username}
        )


@pytest.fixture
async def accounts(client: AsyncClient) -> dict[str, str]:
    """fake: unconfirmed, old, nothing else. The others each miss one rule."""
    fake = await make_user(client, "fake", confirmed=False)
    young = await make_user(client, "young", confirmed=False)
    confirmed = await make_user(client, "confirmed")
    member = await make_user(client, "member", confirmed=False)
    talker = await make_user(client, "talker", confirmed=False)
    owner = await make_user(client, "owner")
    server = await make_server(owner)
    async with engine.begin() as conn:
        # Unconfirmed accounts can't join through the API; put them in directly.
        await conn.execute(
            text("INSERT INTO server_members (server_id, user_id) VALUES (:s, :u)"),
            {"s": uuid.UUID(server["id"]), "u": uuid.UUID(member.id)},
        )
    async with SessionLocal() as session:
        # A message (say, in a server they left since): still not a fake account.
        session.add(Message(channel_id=uuid.UUID(text_channel(server)), author_id=uuid.UUID(talker.id), content="oi"))
        await session.commit()
    for name in ("fake", "confirmed", "member", "talker"):
        await age(name, 40)
    await age("young", 5)
    return {"fake": fake.id, "young": young.id, "confirmed": confirmed.id, "member": member.id, "talker": talker.id}


async def test_dry_run_lists_and_deletes_nothing(accounts: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    assert await cli.accounts_purge(days=30, dry_run=True) == 0
    out = capsys.readouterr().out
    assert "@fake" in out and "1 conta" in out
    for name in ("young", "confirmed", "member", "talker"):
        assert f"@{name}" not in out
    assert all([await exists(i) for i in accounts.values()])


async def test_purge_asks_to_type_the_count(accounts: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("builtins.input", lambda _prompt: "sim")
    assert await cli.accounts_purge(days=30, dry_run=False) == 1
    assert await exists(accounts["fake"])

    monkeypatch.setattr("builtins.input", lambda _prompt: "apagar 1")
    assert await cli.accounts_purge(days=30, dry_run=False) == 0
    assert not await exists(accounts["fake"])
    for name in ("young", "confirmed", "member", "talker"):
        assert await exists(accounts[name]), name


async def test_days_option(accounts: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    assert await cli.accounts_purge(days=1, dry_run=True) == 0
    out = capsys.readouterr().out
    assert "@fake" in out and "@young" in out and "2 conta" in out
