import os
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

# Must be set before the app (and its engine) is imported.
os.environ["POSTGRES_DB"] = "aureum_test"
os.environ["DB_NULL_POOL"] = "true"
os.environ["REDIS_PREFIX"] = "aureum-test"
os.environ["MINIO_BUCKET"] = "aureum-test"
# The real .env names the owner and may have the beta on; tests opt in where they need it.
os.environ["AUREUM_OWNER_USERNAME"] = ""
os.environ["AUREUM_BETA"] = "false"

import asyncpg  # noqa: E402
import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app import badges, livekit_admin, storage  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.realtime import broker  # noqa: E402

API_DIR = Path(__file__).resolve().parents[1]


async def _ensure_test_database() -> None:
    s = get_settings()
    conn = await asyncpg.connect(
        user=s.postgres_user, password=s.postgres_password,
        host=s.postgres_host, port=s.postgres_port, database="postgres",
    )
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", s.postgres_db)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{s.postgres_db}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
async def _database() -> AsyncIterator[None]:
    await _ensure_test_database()
    # Applying the real migrations also checks they stay in sync with the models.
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "heads"], cwd=API_DIR, check=True, env=os.environ
    )
    await storage.ensure_bucket()
    yield
    # Remove this run's uploads. Guarded so it can never touch the real bucket.
    assert get_settings().minio_bucket == "aureum-test"
    await storage.delete_prefix("")
    await broker.close()


@pytest.fixture(autouse=True)
async def _clean_tables() -> AsyncIterator[None]:
    # The badge catalog is seeded at startup (app.badges), and tables are emptied after each test.
    async with SessionLocal() as session:
        await badges.sync_badges(session)
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    # Rate-limit counters would otherwise leak from one test into the next.
    async for key in broker.redis.scan_iter(match=f"{get_settings().redis_prefix}:rl:*"):
        await broker.redis.delete(key)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c



@pytest.fixture(autouse=True)
def livekit_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, dict]]:
    """Records LiveKit server API calls instead of sending them. GetParticipant answers with
    an unmuted mic track."""
    calls: list[tuple[str, str, dict]] = []

    async def fake_post(method: str, room: str, body: dict) -> dict:
        calls.append((method, room, body))
        if method == "GetParticipant":
            return {"tracks": [{"sid": "TR_mic", "source": "MICROPHONE", "muted": False}]}
        return {}

    monkeypatch.setattr(livekit_admin, "_post", fake_post)
    return calls
