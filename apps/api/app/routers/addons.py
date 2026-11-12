from fastapi import APIRouter

from app.addons.registry import ADDONS
from app.deps import CurrentUser
from app.schemas import AddonOut, ServerTypeOut
from app.server_types import SERVER_TYPES

router = APIRouter(tags=["addons"])


@router.get("/server-types", response_model=list[ServerTypeOut])
async def list_server_types(_: CurrentUser) -> list[ServerTypeOut]:
    """The types a new server can have and what comes with each, for the create screen."""
    return [
        ServerTypeOut(type=t.type, name=t.name, description=t.description, addons=sorted(t.keys))
        for t in SERVER_TYPES.values()
    ]


@router.get("/addons", response_model=list[AddonOut])
async def list_addons(_: CurrentUser) -> list[AddonOut]:
    """The addons that can be added as a channel. Those that live in chats (polls) aren't here."""
    return [
        AddonOut(
            key=a.key,
            name=a.name,
            description=a.description,
            icon=a.icon,
            permissions={"view": int(a.action_perm("view")), **{k: int(p) for k, p in a.permissions.items()}},
            config_schema=a.config_model.model_json_schema() if a.config_model else None,
            announces=a.announces,
        )
        for a in ADDONS.values()
        if a.in_channel
    ]
