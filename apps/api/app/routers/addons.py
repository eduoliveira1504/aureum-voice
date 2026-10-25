from fastapi import APIRouter

from app.addons.registry import ADDONS
from app.deps import CurrentUser
from app.schemas import AddonOut

router = APIRouter(tags=["addons"])


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
