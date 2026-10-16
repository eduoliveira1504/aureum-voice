from typing import Any

from httpx import AsyncClient
from httpx_ws.transport import ASGIWebSocketTransport

from app.main import app


class ApiUser:
    def __init__(self, client: AsyncClient, tokens: dict[str, str], me: dict[str, Any]) -> None:
        self.client = client
        self.token = tokens["access_token"]
        self.id: str = me["id"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    async def get(self, path: str, **kw: Any):  # noqa: ANN201
        return await self.client.get(f"/api{path}", headers=self.headers, **kw)

    async def post(self, path: str, json: Any = None):  # noqa: ANN201
        return await self.client.post(f"/api{path}", headers=self.headers, json=json)

    async def patch(self, path: str, json: Any = None):  # noqa: ANN201
        return await self.client.patch(f"/api{path}", headers=self.headers, json=json)

    async def delete(self, path: str):  # noqa: ANN201
        return await self.client.delete(f"/api{path}", headers=self.headers)


async def make_user(client: AsyncClient, username: str) -> ApiUser:
    res = await client.post(
        "/api/auth/register",
        json={"username": username, "email": f"{username}@example.com", "password": "password-123"},
    )
    assert res.status_code == 201, res.text
    tokens = res.json()
    me = await client.get("/api/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    return ApiUser(client, tokens, me.json())


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
