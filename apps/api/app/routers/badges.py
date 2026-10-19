from fastapi import APIRouter
from sqlalchemy import select

from app.deps import CurrentUser, SessionDep
from app.models import Badge
from app.schemas import BadgeOut

router = APIRouter(tags=["badges"])


@router.get("/badges", response_model=list[BadgeOut])
async def list_badges(_: CurrentUser, session: SessionDep) -> list[Badge]:
    """The catalog: what each badge key looks like. Profiles carry only key, number and date."""
    return list(await session.scalars(select(Badge).order_by(Badge.id)))
