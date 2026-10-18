"""LiveKit's server API (Twirp over HTTP), used by voice moderation: a server mute or deafen also
changes the participant's permissions on the media server, so a modified client can't ignore it.

Failures are logged and swallowed: the voice state and the next token enforce the same rules, so
a call that didn't reach LiveKit (not in the room yet, LiveKit unreachable) only delays them.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt

from app.config import get_settings

log = logging.getLogger(__name__)

# Token claim names (lowercase) to the API's TrackSource enum names.
API_SOURCES = {
    "microphone": "MICROPHONE",
    "camera": "CAMERA",
    "screen_share": "SCREEN_SHARE",
    "screen_share_audio": "SCREEN_SHARE_AUDIO",
}


def _admin_token(room: str) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    claims = {
        "iss": settings.livekit_api_key,
        "sub": "aureum-api",
        "nbf": now,
        "exp": now + timedelta(minutes=5),
        "video": {"room": room, "roomAdmin": True},
    }
    return jwt.encode(claims, settings.livekit_api_secret, algorithm="HS256")


async def _post(method: str, room: str, body: dict[str, Any]) -> dict[str, Any]:
    """Calls one RoomService method. Tests replace this function."""
    base = get_settings().livekit_http_url
    async with httpx.AsyncClient(timeout=5) as client:
        res = await client.post(
            f"{base}/twirp/livekit.RoomService/{method}",
            json=body,
            headers={"Authorization": f"Bearer {_admin_token(room)}"},
        )
        res.raise_for_status()
        return res.json()


async def restrict(room: str, identity: str, *, sources: list[str], can_subscribe: bool) -> None:
    """Sets what a participant may publish (token-style source names) and whether they hear
    anyone. A mic that's no longer allowed is muted right away."""
    try:
        await _post(
            "UpdateParticipant",
            room,
            {
                "room": room,
                "identity": identity,
                "permission": {
                    "canPublish": bool(sources),
                    "canSubscribe": can_subscribe,
                    "canPublishData": True,
                    "canPublishSources": [API_SOURCES[s] for s in sources],
                },
            },
        )
        if "microphone" not in sources:
            info = await _post("GetParticipant", room, {"room": room, "identity": identity})
            for track in info.get("tracks", []):
                if track.get("source") == "MICROPHONE" and not track.get("muted"):
                    await _post("MutePublishedTrack", room, {"room": room, "identity": identity, "trackSid": track["sid"], "muted": True})
    except (httpx.HTTPError, ValueError, KeyError) as err:
        log.warning("LiveKit permission update failed for %s in %s: %s", identity, room, err)
