import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, StringConstraints

Username = Annotated[
    str,
    # The pattern is checked before to_lower runs, so it must accept uppercase too.
    StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^[A-Za-z0-9_.]{3,32}$"),
]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
Password = Annotated[str, Field(min_length=8, max_length=128)]
AccentColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
LowerEmail = Annotated[EmailStr, AfterValidator(str.lower)]


class RegisterRequest(BaseModel):
    username: Username
    email: LowerEmail
    password: Password
    display_name: DisplayName | None = None


class LoginRequest(BaseModel):
    email: LowerEmail
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None
    banner_url: str | None
    bio: str | None
    accent_color: str | None
    created_at: datetime


class UserMe(UserPublic):
    email: str


class UserUpdate(BaseModel):
    display_name: DisplayName | None = None
    bio: Annotated[str, Field(max_length=190)] | None = None
    accent_color: AccentColor | None = None
