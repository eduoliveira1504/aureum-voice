"""Block 4.2.1: server types and the addons each one allows."""

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.addons.registry import ADDONS
from app.db import engine
from app.models import ServerType
from app.server_types import FEATURES, SERVER_TYPES
from tests.helpers import make_user


def test_every_key_is_a_real_addon_or_feature() -> None:
    known = set(ADDONS) | FEATURES
    for info in SERVER_TYPES.values():
        assert info.keys <= known, f"{info.type}: unknown keys {info.keys - known}"
    assert set(SERVER_TYPES) == set(ServerType)


def test_mixed_allows_everything_the_others_do() -> None:
    mixed = SERVER_TYPES[ServerType.mixed].keys
    assert SERVER_TYPES[ServerType.game].keys | SERVER_TYPES[ServerType.work].keys == mixed


async def test_servers_saved_without_a_type_are_mixed(client: AsyncClient) -> None:
    # What the migration does to servers that existed before it: the column's default.
    owner = await make_user(client, "owner")
    server_id = uuid.uuid4()
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO servers (id, name, owner_id) VALUES (:id, 'Antigo', :owner)"),
            {"id": server_id, "owner": uuid.UUID(owner.id)},
        )
        assert (await conn.execute(text("SELECT type FROM servers WHERE id = :id"), {"id": server_id})).scalar() == "mixed"
