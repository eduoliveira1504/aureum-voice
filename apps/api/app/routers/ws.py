import asyncio
import json
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.access import co_member_ids
from app.db import SessionLocal
from app.models import User
from app.realtime import broker
from app.security import decode_token

router = APIRouter()

# Clients ping every ~25s; a connection silent for this long is considered dead.
RECEIVE_TIMEOUT_SECONDS = 60
# Close code telling the client its token is invalid/expired, so it refreshes before reconnecting.
CLOSE_UNAUTHORIZED = 4401


async def _publish_presence(user_id: uuid.UUID, online: bool) -> None:
    async with SessionLocal() as session:
        recipients = await co_member_ids(session, user_id)
    await broker.publish("presence.updated", {"user_id": str(user_id), "online": online}, recipients)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query("")) -> None:
    await websocket.accept()
    user_id = decode_token(token, "access")
    if user_id is not None:
        async with SessionLocal() as session:
            if await session.get(User, user_id) is None:
                user_id = None
    if user_id is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED)
        return

    await broker.ensure_listening()
    connection_id = uuid.uuid4().hex
    broker.register(user_id, websocket)
    try:
        if await broker.heartbeat(user_id, connection_id):
            await _publish_presence(user_id, True)
        await websocket.send_json({"type": "ready", "data": {"user_id": str(user_id)}})

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), RECEIVE_TIMEOUT_SECONDS)
            except TimeoutError:
                break
            await broker.heartbeat(user_id, connection_id)
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if isinstance(message, dict) and message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "data": None})
    except WebSocketDisconnect:
        pass
    finally:
        broker.unregister(user_id, websocket)
        if await broker.disconnect(user_id, connection_id):
            await _publish_presence(user_id, False)
