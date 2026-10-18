import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    computed_field,
    field_validator,
    model_validator,
)

from app.models import DEFAULT_ACCENT, ChannelType, OverrideTarget, Theme, UserStatus
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


def _https_only(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("Only https:// links are allowed")
    return url


HttpsUrl = Annotated[str, StringConstraints(strip_whitespace=True, max_length=512), AfterValidator(_https_only)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]

# Avatar frames: none, the profile color, or a fixed preset (colors live in the app).
AvatarFrame = Literal["none", "accent", "gold", "amethyst", "emerald", "ember", "sapphire"]
# Badges are granted by the system (python -m app.cli badges), never chosen by the user.
BADGES = ("founder", "beta")
MAX_LINKS = 5


class CustomStatus(BaseModel):
    """Status bubble next to the avatar: optional emoji plus text, until it expires."""

    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=128)] = ""
    emoji: Annotated[str, StringConstraints(strip_whitespace=True, max_length=16)] | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> "CustomStatus":
        if not self.text and not self.emoji:
            raise ValueError("A status needs text or an emoji")
        return self

    def expired(self) -> bool:
        return self.expires_at is not None and self.expires_at <= datetime.now(UTC)


class FavoriteSong(BaseModel):
    title: ShortText
    artist: ShortText
    url: HttpsUrl | None = None


class ProfileLink(BaseModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)]
    url: HttpsUrl


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None
    banner_url: str | None
    bio: str | None
    accent_color: str | None
    pronouns: str | None = None
    custom_status: CustomStatus | None = None
    avatar_frame: str = "none"
    favorite_song: FavoriteSong | None = None
    links: list[ProfileLink] = []
    badges: list[str] = []
    created_at: datetime

    @field_validator("custom_status", mode="after")
    @classmethod
    def _hide_expired(cls, value: CustomStatus | None) -> CustomStatus | None:
        # Expired statuses stay in the database until replaced; nobody sees them.
        return None if value is not None and value.expired() else value


class UserMe(UserPublic):
    email: str


# What others see (see app.presence): invisible users show as offline.
Presence = Literal["online", "idle", "dnd", "offline"]


class WithPresence(BaseModel):
    status: Presence = "offline"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def online(self) -> bool:
        return self.status != "offline"


class UserUpdate(BaseModel):
    """Profile fields; an explicit null clears a field (except display_name)."""

    display_name: DisplayName | None = None
    bio: Annotated[str, Field(max_length=190)] | None = None
    accent_color: AccentColor | None = None
    pronouns: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None
    custom_status: CustomStatus | None = None
    avatar_frame: AvatarFrame | None = None
    favorite_song: FavoriteSong | None = None
    links: Annotated[list[ProfileLink], Field(max_length=MAX_LINKS)] | None = None

    @field_validator("pronouns", mode="after")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value or None


SoundEvent = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z_.]{0,31}$")]


class SoundSettings(BaseModel):
    """Volume plus an on/off switch per sound event. Events missing from the map are on, so
    sounds added in later versions start enabled."""

    volume: Annotated[int, Field(ge=0, le=100)] = 80
    events: Annotated[dict[SoundEvent, bool], Field(max_length=32)] = {}


# What a panel tab shows: the server overview, the expanded call, a channel or an addon.
PanelTab = Annotated[
    str, StringConstraints(pattern=r"^(overview|call|channel:[0-9a-f-]{36}|addon:[a-z0-9_-]{1,32})$")
]


class Panel(BaseModel):
    tabs: Annotated[list[PanelTab], Field(max_length=12)] = []
    active: PanelTab | None = None


class PanelLayout(BaseModel):
    """Up to two panels side by side; `split` is the first panel's share of the width."""

    panels: Annotated[list[Panel], Field(min_length=1, max_length=2)]
    split: Annotated[float, Field(ge=0.2, le=0.8)] = 0.5


TabList = Annotated[list[uuid.UUID], Field(max_length=200)]


class UserAudio(BaseModel):
    """How loud one person sounds to the user in calls (100 = as sent), and a local mute."""

    volume: Annotated[int, Field(ge=0, le=200)] = 100
    muted: bool = False


ColumnKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_.-]{0,39}$")]
ColumnSize = Annotated[int, Field(ge=48, le=2000)]


class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    theme: Theme = Theme.dark
    accent_color: str = DEFAULT_ACCENT
    sounds: SoundSettings = SoundSettings()
    status: UserStatus = UserStatus.online
    tab_order: list[uuid.UUID] = []
    closed_tabs: list[uuid.UUID] = []
    sidebar_collapsed: bool = False
    members_open: bool = False
    panel_layouts: dict[uuid.UUID, PanelLayout] = {}
    user_audio: dict[uuid.UUID, UserAudio] = {}
    column_sizes: dict[ColumnKey, ColumnSize] = {}
    muted_places: list[uuid.UUID] = []


class SettingsUpdate(BaseModel):
    theme: Theme | None = None
    accent_color: AccentColor | None = None
    sounds: SoundSettings | None = None
    status: UserStatus | None = None
    tab_order: TabList | None = None
    closed_tabs: TabList | None = None
    sidebar_collapsed: bool | None = None
    members_open: bool | None = None
    # Merged per server: a layout replaces that server's, null removes it, others are kept.
    # That way two PCs arranging different servers don't overwrite each other.
    panel_layouts: Annotated[dict[uuid.UUID, PanelLayout | None], Field(max_length=50)] | None = None
    # Merged the same way, per user id and per column key.
    user_audio: Annotated[dict[uuid.UUID, UserAudio | None], Field(max_length=50)] | None = None
    column_sizes: Annotated[dict[ColumnKey, ColumnSize | None], Field(max_length=30)] | None = None
    muted_places: Annotated[list[uuid.UUID], Field(max_length=500)] | None = None


# --- Friends --------------------------------------------------------------

# friend: accepted both ways | incoming/outgoing: a pending request | blocked: blocked by me.
FriendKind = Literal["friend", "incoming", "outgoing", "blocked"]


class FriendRequest(BaseModel):
    # Accepts "@name" too, as people type it.
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=33)]


class FriendOut(WithPresence):
    user: UserPublic
    kind: FriendKind
    since: datetime


# --- Addons ---------------------------------------------------------------


class AddonOut(BaseModel):
    key: str
    name: str
    description: str
    icon: str
    # Action name -> the channel permission bit it needs ("view" included).
    permissions: dict[str, int]
    # JSON Schema of the addon's channel settings, if it has any.
    config_schema: dict[str, Any] | None


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
    banner_url: str | None
    owner_id: uuid.UUID
    created_at: datetime


# Bitfield of app.permissions.Perm (24 bits, so it's safe as a JSON number).
Permissions = Annotated[int, Field(ge=0, lt=1 << 24)]
RoleColor = AccentColor


class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    server_id: uuid.UUID
    name: str
    color: str | None
    icon_url: str | None
    position: int
    permissions: int
    hoist: bool
    mentionable: bool


class RoleCreate(BaseModel):
    name: Name
    color: RoleColor | None = None
    permissions: Permissions = 0
    hoist: bool = False
    mentionable: bool = False


class RoleUpdate(BaseModel):
    """Only the fields sent change; color can be cleared with null."""

    name: Name | None = None
    color: RoleColor | None = None
    permissions: Permissions | None = None
    hoist: bool | None = None
    mentionable: bool | None = None


class RoleOrder(BaseModel):
    # Every role but @everyone, strongest first.
    role_ids: Annotated[list[uuid.UUID], Field(max_length=250)]


class OverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    target_type: OverrideTarget
    target_id: uuid.UUID
    allow: int
    deny: int


class OverrideSet(BaseModel):
    allow: Permissions = 0
    deny: Permissions = 0


class BanCreate(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None


class BanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserPublic
    reason: str | None
    created_at: datetime


AddonKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_-]{1,32}$")]


class ChannelCreate(BaseModel):
    name: Name
    type: Literal["text", "voice", "addon"] = "text"
    # Addon channels only.
    addon_key: AddonKey | None = None
    config: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _addon_fields(self) -> "ChannelCreate":
        if (self.type == "addon") != (self.addon_key is not None):
            raise ValueError("addon_key is required for addon channels, and only for them")
        if self.config is not None and self.type != "addon":
            raise ValueError("Only addon channels have settings")
        return self


class ChannelUpdate(BaseModel):
    name: Name | None = None
    position: Annotated[int, Field(ge=0)] | None = None
    # Addon channels only; replaces the settings as a whole.
    config: dict[str, Any] | None = None


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    server_id: uuid.UUID | None
    name: str | None
    type: ChannelType
    position: int
    # Addon channels only.
    addon_key: str | None = None
    config: dict[str, Any] = {}
    # Server channels only.
    overrides: list[OverrideOut] = []


class MemberOut(WithPresence):
    model_config = ConfigDict(from_attributes=True)

    user: UserPublic
    # Without @everyone, which everyone has.
    role_ids: list[uuid.UUID] = []
    joined_at: datetime
    nickname: str | None = None
    # Server mute / deafen by a moderator.
    voice_muted: bool = False
    voice_deafened: bool = False


class VoiceModeration(BaseModel):
    """Any of: server mute, server deafen, or move to another room (channel_id)."""

    muted: bool | None = None
    deafened: bool | None = None
    channel_id: uuid.UUID | None = None


class MemberUpdate(BaseModel):
    # Empty or null clears it.
    nickname: Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)] | None


class ReadStateOut(BaseModel):
    channel_id: uuid.UUID
    last_read_message_id: int
    unread_count: int
    mention_count: int


class CallParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    rung_at: datetime | None
    joined_at: datetime | None
    left_at: datetime | None
    declined_at: datetime | None


class CallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    channel_id: uuid.UUID
    started_by: uuid.UUID | None
    started_at: datetime
    ended_at: datetime | None
    participants: list[CallParticipantOut]


class CallRing(BaseModel):
    user_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=9)]


MAX_GROUP_MEMBERS = 10


class DmMemberOut(WithPresence):
    user: UserPublic


class DmOut(BaseModel):
    """A 1:1 DM or a group DM, as seen by one member (the read state is theirs)."""

    id: uuid.UUID
    type: ChannelType
    name: str | None
    members: list[DmMemberOut]
    # 0 when empty; lets clients sort conversations by latest activity.
    last_message_id: int
    read: ReadStateOut
    # The call in progress, and who is in it right now.
    call: CallOut | None = None
    voice_states: list[VoiceState] = []


class DmCreate(BaseModel):
    user_id: uuid.UUID


GroupInvitees = Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_GROUP_MEMBERS - 1)]


class GroupCreate(BaseModel):
    user_ids: GroupInvitees
    name: Name | None = None


class GroupUpdate(BaseModel):
    # null clears it (the group is then named after its members).
    name: Name | None


class GroupMembersAdd(BaseModel):
    user_ids: GroupInvitees


class ServerDetail(ServerOut):
    # @everyone included (its id is the server's), strongest first.
    roles: list[RoleOut] = []
    # Only the channels the requesting user can see.
    channels: list[ChannelOut]
    members: list[MemberOut]
    voice_states: list[VoiceState] = []
    # The requesting user's unread state per text channel.
    reads: list[ReadStateOut] = []


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


class MarkRead(BaseModel):
    # Read up to this message; omitted = everything.
    message_id: Annotated[int, Field(ge=0)] | None = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    channel_id: uuid.UUID
    author: UserPublic | None
    content: str
    attachments: list[dict[str, Any]]
    created_at: datetime
    edited_at: datetime | None
    # The call this line stands for (DMs only).
    call: CallOut | None = None
