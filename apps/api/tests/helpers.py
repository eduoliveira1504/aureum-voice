from typing import Any

from httpx import AsyncClient
from httpx_ws.transport import ASGIWebSocketTransport

from app.db import SessionLocal
from app.main import app
from app.models import User
from app.security import create_token, hash_password

PASSWORD = "password-123"


class ApiUser:
    def __init__(self, client: AsyncClient, token: str, me: dict[str, Any]) -> None:
        self.client = client
        self.token = token
        self.id: str = me["id"]
        self.email: str = me["email"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    async def get(self, path: str, **kw: Any):  # noqa: ANN201
        return await self.client.get(f"/api{path}", headers=self.headers, **kw)

    async def post(self, path: str, json: Any = None):  # noqa: ANN201
        return await self.client.post(f"/api{path}", headers=self.headers, json=json)

    async def patch(self, path: str, json: Any = None):  # noqa: ANN201
        return await self.client.patch(f"/api{path}", headers=self.headers, json=json)

    async def put(self, path: str, json: Any = None):  # noqa: ANN201
        return await self.client.put(f"/api{path}", headers=self.headers, json=json)

    async def delete(self, path: str):  # noqa: ANN201
        return await self.client.delete(f"/api{path}", headers=self.headers)


async def make_user(client: AsyncClient, username: str) -> ApiUser:
    """Creates an account directly in the database (sign-up itself needs an invite and is
    covered by test_auth), then talks to the API with a normal access token."""
    async with SessionLocal() as session:
        user = User(
            username=username,
            email=f"{username}@example.com",
            display_name=username,
            password_hash=hash_password(PASSWORD),
        )
        session.add(user)
        await session.commit()
    token = create_token(user.id, "access")
    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    return ApiUser(client, token, me.json())


async def make_server(owner: ApiUser, *members: ApiUser, name: str = "Squad") -> dict[str, Any]:
    res = await owner.post("/servers", {"name": name})
    assert res.status_code == 201, res.text
    server = res.json()
    if members:
        code = (await owner.post(f"/servers/{server['id']}/invites", {})).json()["code"]
        for m in members:
            assert (await m.post(f"/invites/{code}/join")).status_code == 200
    return server


def text_channel(server: dict[str, Any]) -> str:
    return next(c["id"] for c in server["channels"] if c["type"] == "text")


def ws_client() -> AsyncClient:
    """Client that speaks WebSocket. Open it inside the test body: its transport runs a task
    group that must be entered and exited in the same task, which fixtures don't guarantee."""
    return AsyncClient(transport=ASGIWebSocketTransport(app=app), base_url="http://test")
