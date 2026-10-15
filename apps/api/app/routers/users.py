import uuid

from fastapi import APIRouter, HTTPException, status

from app.deps import CurrentUser, SessionDep
from app.models import User
from app.schemas import UserMe, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMe)
async def get_me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserMe)
async def update_me(body: UserUpdate, user: CurrentUser, session: SessionDep) -> User:
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "display_name" and value is None:
            continue  # display_name is required; ignore explicit nulls
        setattr(user, field, value)
    await session.commit()
    return user


@router.get("/{user_id}", response_model=UserPublic)
async def get_user(user_id: uuid.UUID, _: CurrentUser, session: SessionDep) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user
