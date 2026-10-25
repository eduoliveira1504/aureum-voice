from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app import badges
from app.deps import CurrentUser, SessionDep
from app.models import Badge, User
from app.schemas import BadgeOut, FeaturedBadges, UserMe

router = APIRouter(tags=["badges"])


@router.get("/badges", response_model=list[BadgeOut])
async def list_badges(_: CurrentUser, session: SessionDep) -> list[BadgeOut]:
    """The catalog: what each badge key looks like. Profiles carry only key, number and date."""
    available = await badges.available_keys(session)
    rows = await session.scalars(select(Badge).order_by(Badge.id))
    return [BadgeOut.model_validate(row).model_copy(update={"available": row.key in available}) for row in rows]


@router.put("/users/me/badges/featured", response_model=UserMe)
async def set_featured_badges(body: FeaturedBadges, user: CurrentUser, session: SessionDep) -> User:
    """The badges next to my name, in order (up to 3); an empty list goes back to the automatic pick."""
    try:
        await badges.set_featured(session, user, body.keys)
    except KeyError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="You can only feature badges you hold") from err
    await session.commit()
    await badges.announce(session, user)
    return user
