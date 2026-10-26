from httpx import AsyncClient
from httpx_ws import aconnect_ws

from tests.helpers import make_user, ws_client
from tests.test_ws import next_event

DEFAULTS = {
    "theme": "dark",
    "accent_color": "#E8B531",
    "sounds": {"volume": 80, "events": {}},
    "tab_order": [],
    "closed_tabs": [],
    "sidebar_collapsed": False,
    "members_open": False,
    "panel_layouts": {},
    "user_audio": {},
    "column_sizes": {},
    "muted_places": [],
    "status": "online",
    "official_dm": {},
    "news_dismissed": None,
    "emoji_tone": 0,
    "recent_emojis": [],
    "read_receipts": True,
    "recent_stickers": [],
    "soundboard_volume": 100,
    "soundboard_muted": False,
}


async def test_defaults_without_a_row(client: AsyncClient) -> None:
    user = await make_user(client, "fresh")
    res = await user.get("/users/me/settings")
    assert res.status_code == 200
    assert res.json() == DEFAULTS


async def test_partial_updates_keep_the_rest(client: AsyncClient) -> None:
    user = await make_user(client, "prefs")
    res = await user.patch("/users/me/settings", {"theme": "light"})
    assert res.status_code == 200
    assert res.json() == {**DEFAULTS, "theme": "light"}

    await user.patch("/users/me/settings", {"accent_color": "#8b5cf6", "theme": None})
    sounds = {"volume": 35, "events": {"call.join": False}}
    await user.patch("/users/me/settings", {"sounds": sounds})
    assert (await user.get("/users/me/settings")).json() == {
        **DEFAULTS,
        "theme": "light",
        "accent_color": "#8b5cf6",
        "sounds": sounds,
    }


async def test_settings_are_private(client: AsyncClient) -> None:
    alice, bob = await make_user(client, "alice"), await make_user(client, "bob")
    await alice.patch("/users/me/settings", {"theme": "system"})
    assert (await bob.get("/users/me/settings")).json()["theme"] == "dark"


async def test_validation(client: AsyncClient) -> None:
    user = await make_user(client, "strict")
    for body in (
        {"theme": "sepia"},
        {"accent_color": "gold"},
        {"sounds": {"volume": 101}},
        {"sounds": {"events": {"Not A Key": True}}},
        {"tab_order": ["not-a-uuid"]},
        {"panel_layouts": {SERVER_A: {"panels": []}}},
        {"panel_layouts": {SERVER_A: {"panels": [{}, {}, {}]}}},
        {"panel_layouts": {SERVER_A: {"panels": [{"tabs": ["javascript:alert(1)"]}]}}},
        {"panel_layouts": {SERVER_A: {"panels": [{}], "split": 0.95}}},
        {"panel_layouts": {SERVER_A: {"panels": [{}], "members": ["javascript:alert(1)"]}}},
        {"user_audio": {SERVER_A: {"volume": 201}}},
        {"user_audio": {"not-a-uuid": {"volume": 50}}},
        {"column_sizes": {"Sidebar": 240}},
        {"column_sizes": {"sidebar": 10}},
        {"muted_places": ["nope"]},
    ):
        assert (await user.patch("/users/me/settings", body)).status_code == 422, body


async def test_update_reaches_the_users_other_devices(client: AsyncClient) -> None:
    user = await make_user(client, "devices")
    async with ws_client() as wsc, aconnect_ws(f"/ws?token={user.token}", wsc) as ws:
        await next_event(ws, "ready")
        await user.patch("/users/me/settings", {"accent_color": "#4f8cc9"})
        assert (await next_event(ws, "settings.updated"))["accent_color"] == "#4f8cc9"


SERVER_A = "11111111-1111-4111-8111-111111111111"
SERVER_B = "22222222-2222-4222-8222-222222222222"
CHANNEL = "33333333-3333-4333-8333-333333333333"


async def test_shell_layout_round_trip(client: AsyncClient) -> None:
    user = await make_user(client, "layout")
    body = {
        "tab_order": [SERVER_B, SERVER_A],
        "closed_tabs": [SERVER_B],
        "sidebar_collapsed": True,
    }
    assert (await user.patch("/users/me/settings", body)).status_code == 200
    saved = (await user.get("/users/me/settings")).json()
    assert {k: saved[k] for k in body} == body


async def test_panel_layouts_merge_per_server(client: AsyncClient) -> None:
    user = await make_user(client, "panels")
    split = {
        "panels": [
            {"tabs": [f"channel:{CHANNEL}", "overview"], "active": f"channel:{CHANNEL}"},
            {"tabs": ["addon:board"], "active": "addon:board"},
        ],
        "split": 0.6,
        # The member list is remembered per tab.
        "members": [f"channel:{CHANNEL}"],
    }
    single = {"panels": [{"tabs": ["call"], "active": "call"}], "split": 0.5, "members": []}
    await user.patch("/users/me/settings", {"panel_layouts": {SERVER_A: split}})
    # Another PC arranges a different server: the first layout survives.
    await user.patch("/users/me/settings", {"panel_layouts": {SERVER_B: single}})
    assert (await user.get("/users/me/settings")).json()["panel_layouts"] == {SERVER_A: split, SERVER_B: single}

    # null drops one server's layout.
    res = await user.patch("/users/me/settings", {"panel_layouts": {SERVER_A: None}})
    assert res.json()["panel_layouts"] == {SERVER_B: single}


async def test_call_audio_and_columns_merge(client: AsyncClient) -> None:
    user = await make_user(client, "audio")
    await user.patch("/users/me/settings", {"user_audio": {SERVER_A: {"volume": 150}}, "column_sizes": {"sidebar": 280}})
    # Another PC tunes someone else and another column: both changes survive.
    await user.patch("/users/me/settings", {"user_audio": {SERVER_B: {"muted": True}}, "column_sizes": {"members": 300}})
    saved = (await user.get("/users/me/settings")).json()
    assert saved["user_audio"] == {SERVER_A: {"volume": 150, "muted": False}, SERVER_B: {"volume": 100, "muted": True}}
    assert saved["column_sizes"] == {"sidebar": 280, "members": 300}

    res = await user.patch("/users/me/settings", {"user_audio": {SERVER_A: None}, "column_sizes": {"sidebar": None}})
    assert res.json()["user_audio"] == {SERVER_B: {"volume": 100, "muted": True}}
    assert res.json()["column_sizes"] == {"members": 300}

    # Muted places are a plain list, replaced as a whole.
    await user.patch("/users/me/settings", {"muted_places": [SERVER_A, CHANNEL]})
    res = await user.patch("/users/me/settings", {"muted_places": [CHANNEL]})
    assert res.json()["muted_places"] == [CHANNEL]


async def test_dismissed_news_version(client: AsyncClient) -> None:
    user = await make_user(client, "news")
    res = await user.patch("/users/me/settings", {"news_dismissed": "0.2.0-beta.3"})
    assert res.status_code == 200 and res.json()["news_dismissed"] == "0.2.0-beta.3"
    # Other settings leave it alone.
    await user.patch("/users/me/settings", {"theme": "light"})
    assert (await user.get("/users/me/settings")).json()["news_dismissed"] == "0.2.0-beta.3"
    for bad in ["", "x" * 41, "0.2 beta", "<b>"]:
        assert (await user.patch("/users/me/settings", {"news_dismissed": bad})).status_code == 422, bad


async def test_emoji_tone_and_recents(client: AsyncClient) -> None:
    user = await make_user(client, "emoji")
    defaults = (await user.get("/users/me/settings")).json()
    assert (defaults["emoji_tone"], defaults["recent_emojis"]) == (0, [])
    res = await user.patch("/users/me/settings", {"emoji_tone": 3, "recent_emojis": ["🔥", "👍🏽"]})
    assert res.status_code == 200 and (res.json()["emoji_tone"], res.json()["recent_emojis"]) == (3, ["🔥", "👍🏽"])
    for bad in [{"emoji_tone": 6}, {"emoji_tone": -1}, {"recent_emojis": ["🔥"] * 37}, {"recent_emojis": [""]}]:
        assert (await user.patch("/users/me/settings", bad)).status_code == 422, bad
