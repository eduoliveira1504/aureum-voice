import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, StringConstraints

from app.models import DEFAULT_ACCENT, ChannelType, MemberRole, Theme
from app.voice import VoiceState

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
    invite_code: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None


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


SoundEvent = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z_.]{0,31}$")]


class SoundSettings(BaseModel):
    """Volume plus an on/off switch per sound event. Events missing from the map are on, so
    sounds added in later versions start enabled."""

    volume: Annotated[int, Field(ge=0, le=100)] = 80
    events: Annotated[dict[SoundEvent, bool], Field(max_length=32)] = {}


class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    theme: Theme = Theme.dark
    accent_color: str = DEFAULT_ACCENT
    sounds: SoundSettings = SoundSettings()


class SettingsUpdate(BaseModel):
    theme: Theme | None = None
    accent_color: AccentColor | None = None
    sounds: SoundSettings | None = None


# --- Servers, channels, invites -------------------------------------------

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ServerCreate(BaseModel):
    name: Name


class ServerUpdate(BaseModel):
    name: Name | None = None


class ServerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    icon_url: str | None
    owner_id: uuid.UUID
    created_at: datetime


class ChannelCreate(BaseModel):
    name: Name
    type: Literal["text", "voice"] = "text"


class ChannelUpdate(BaseModel):
    name: Name | None = None
    position: Annotated[int, Field(ge=0)] | None = None


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    server_id: uuid.UUID | None
    name: str | None
    type: ChannelType
    position: int


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserPublic
    role: MemberRole
    joined_at: datetime
    online: bool = False


class ServerDetail(ServerOut):
    channels: list[ChannelOut]
    members: list[MemberOut]
    voice_states: list[VoiceState] = []


class VoiceTokenOut(BaseModel):
    token: str
    url: str


class InviteCreate(BaseModel):
    max_uses: Annotated[int, Field(ge=1, le=1000)] | None = None
    expires_in_hours: Annotated[int, Field(ge=1, le=24 * 30)] | None = 24 * 7


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    server_id: uuid.UUID
    expires_at: datetime | None
    max_uses: int | None
    uses: int


# --- Messages -----------------------------------------------------------------

Content = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class MessageCreate(BaseModel):
    content: Content


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    channel_id: uuid.UUID
    author: UserPublic | None
    content: str
    attachments: list[dict[str, Any]]
    created_at: datetime
    edited_at: datetime | None
