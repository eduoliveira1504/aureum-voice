"""Database models. Every table from the data model lives here so the schema is
created in full, including tables that later phases will use (oauth_accounts, DMs)."""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Deterministic constraint names keep Alembic migrations stable.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _str_enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    # Stored as VARCHAR + CHECK instead of a native Postgres enum: easier to extend later.
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda e: [m.value for m in e],
    )


class Theme(str, enum.Enum):
    dark = "dark"
    light = "light"
    system = "system"


class UserStatus(str, enum.Enum):
    """The status a user picks. Idle also turns on by itself after a while without input, and
    invisible shows the user as offline to everyone else."""

    online = "online"
    idle = "idle"
    dnd = "dnd"
    invisible = "invisible"


class FriendshipStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    blocked = "blocked"


class OverrideTarget(str, enum.Enum):
    role = "role"
    member = "member"


class ChannelType(str, enum.Enum):
    text = "text"
    voice = "voice"
    dm = "dm"
    group_dm = "group_dm"
    # A server channel run by an addon (see app/addons).
    addon = "addon"


class UserPlan(str, enum.Enum):
    """What the user pays for. Only the free plan exists for now (see app/media.py)."""

    free = "free"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))  # null for OAuth-only accounts
    avatar_url: Mapped[str | None] = mapped_column(String(512))
    banner_url: Mapped[str | None] = mapped_column(String(512))
    bio: Mapped[str | None] = mapped_column(String(190))
    accent_color: Mapped[str | None] = mapped_column(String(7))  # "#rrggbb", the profile card color
    pronouns: Mapped[str | None] = mapped_column(String(40))
    # {"text", "emoji", "expires_at"}; shown as a bubble next to the avatar until it expires.
    custom_status: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # "none", "accent" or a preset key (see schemas.AVATAR_FRAMES).
    avatar_frame: Mapped[str] = mapped_column(String(16), default="none", server_default="none", nullable=False)
    favorite_song: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # {"title", "artist", "url"}
    links: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # Decides the media tier (streaming quality limits) the voice token hands out.
    plan: Mapped[UserPlan] = mapped_column(
        _str_enum(UserPlan, "user_plan"), default=UserPlan.free, server_default=UserPlan.free.value, nullable=False
    )
    # Set when the user types the code sent to their e-mail. Until then they can sign in but
    # not create servers, and get none of what confirming brings (see app/onboarding.py).
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The company's own accounts (@aureum, made with the CLI's --oficial): never the beta badge
    # nor account invites. --oficial also sets is_verified and is_bot.
    is_official: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Shown next to the name everywhere: a gold check ("Conta verificada") and a "BOT" tag
    # ("Conta automatizada do Aureum"). Only the CLI sets them (--verificado, --bot).
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_bot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Accounts the CLI made with a temporary password: nothing works until it's replaced.
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Copied into every token; bumping it ends all sessions (password changed or reset).
    session_epoch: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = _created_at()

    # Badges the user holds (see app/badges.py), loaded with the user: every profile shows them.
    badge_grants: Mapped[list["UserBadge"]] = relationship(
        lazy="selectin", foreign_keys="UserBadge.user_id", order_by="UserBadge.granted_at",
        cascade="all, delete-orphan",
    )

    @property
    def badges(self) -> list["UserBadge"]:
        return self.badge_grants


DEFAULT_ACCENT = "#E8B531"  # Aureum gold


class BadgeRarity(str, enum.Enum):
    """Rarest last. The metal of the frame shows it: bronze, silver, gold, gold with a shine."""

    comum = "comum"
    rara = "rara"
    lendaria = "lendaria"
    mitica = "mitica"


class Badge(Base):
    """A badge anyone may hold. Rows are kept in sync with app/badges.py (the code is the
    source); the id never changes, so renaming a badge or swapping its art keeps every grant."""

    __tablename__ = "badges"

    id: Mapped[int] = mapped_column(Integer, Identity(), primary_key=True)
    key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default="")
    # Full art (tooltips, big sizes) and the simplified one for 32 px and below.
    icon_svg: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    icon_svg_small: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    rarity: Mapped[BadgeRarity] = mapped_column(_str_enum(BadgeRarity, "badge_rarity"), nullable=False)
    # Numbered badges show the holder's place, e.g. "Pioneiro #7".
    numbered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Only granted while the beta runs (AUREUM_BETA), never again after it.
    exclusive_beta: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Breaks ties between badges of the same rarity next to a name (lower first).
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")


class UserBadge(Base):
    """A badge held by a user. Granted by the system or the app owner, never by the user."""

    __tablename__ = "user_badges"
    __table_args__ = (UniqueConstraint("badge_id", "number"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    badge_id: Mapped[int] = mapped_column(ForeignKey("badges.id", ondelete="CASCADE"), primary_key=True, index=True)
    number: Mapped[int | None] = mapped_column(Integer)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # NULL: granted by the system (sign-up, a resolved bug report...).
    granted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    badge: Mapped[Badge] = relationship(lazy="joined")

    @property
    def key(self) -> str:
        return self.badge.key


class UserSettings(Base):
    """Per-user app preferences, applied on every device the user signs in from. A user
    without a row simply gets the defaults."""

    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    theme: Mapped[Theme] = mapped_column(
        _str_enum(Theme, "theme"), default=Theme.dark, server_default=Theme.dark.value, nullable=False
    )
    # UI accent; unrelated to users.accent_color, which colors the profile card.
    accent_color: Mapped[str] = mapped_column(
        String(7), default=DEFAULT_ACCENT, server_default=DEFAULT_ACCENT, nullable=False
    )
    sounds: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    status: Mapped[UserStatus] = mapped_column(
        _str_enum(UserStatus, "user_status"),
        default=UserStatus.online,
        server_default=UserStatus.online.value,
        nullable=False,
    )
    # App shell layout, so it looks the same on every PC. Tabs are server ids.
    tab_order: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    closed_tabs: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    sidebar_collapsed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # The member list panel next to a server's panels.
    members_open: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Open panels per server id (see schemas.PanelLayout).
    panel_layouts: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    # How loud the user hears each person in calls, by user id (see schemas.UserAudio).
    user_audio: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    # Widths in px of resizable columns, by column key (sidebar, members, ...).
    column_sizes: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    # Channels and servers the user silenced: no unread badges (mentions still count).
    muted_places: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # Categories of the official DM (app/bot) the user turned off, e.g. {"novidades": false}.
    # Missing means on; "seguranca" can't be turned off.
    official_dm: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class OAuthAccount(Base):
    __tablename__ = "oauth_accounts"
    __table_args__ = (UniqueConstraint("provider", "provider_user_id"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_user_id: Mapped[str] = mapped_column(String(255), nullable=False)


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    icon_url: Mapped[str | None] = mapped_column(String(512))
    banner_url: Mapped[str | None] = mapped_column(String(512))
    # The owner has every permission and is above every role (see app.permissions).
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    # Official servers (set with the CLI) take in everyone who confirms their e-mail.
    is_official: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = _created_at()


class Role(Base):
    """A server role. Every server has an @everyone role whose id is the server's id: everyone
    has it implicitly (no member_roles row) and it sits at position 0, below every other role."""

    __tablename__ = "roles"

    id: Mapped[uuid.UUID] = _uuid_pk()
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7))  # "#rrggbb"
    icon_url: Mapped[str | None] = mapped_column(String(512))
    # Higher is stronger; @everyone is 0 and the others are 1..n without gaps.
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    permissions: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    # Shown as its own group in the member list.
    hoist: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    mentionable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = _created_at()

    @property
    def is_everyone(self) -> bool:
        return self.id == self.server_id


class MemberRole(Base):
    """A role given to a server member. Removed with the membership (leaving, kick, ban)."""

    __tablename__ = "member_roles"

    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True, index=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["server_id", "user_id"],
            ["server_members.server_id", "server_members.user_id"],
            ondelete="CASCADE",
            name="fk_member_roles_member_server_members",
        ),
    )


class ServerBan(Base):
    __tablename__ = "server_bans"

    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    banned_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reason: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created_at()

    user: Mapped[User] = relationship(lazy="joined", foreign_keys=[user_id])


class ServerMember(Base):
    __tablename__ = "server_members"

    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    joined_at: Mapped[datetime] = _created_at()
    # Shown instead of the display name inside this server.
    nickname: Mapped[str | None] = mapped_column(String(32))
    # Server mute / deafen by a moderator: kept across calls until lifted.
    voice_muted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    voice_deafened: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    user: Mapped[User] = relationship(lazy="joined")


class Invite(Base):
    __tablename__ = "invites"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_uses: Mapped[int | None] = mapped_column(Integer)
    uses: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[uuid.UUID] = _uuid_pk()
    # Nullable: phase 2 uses server-less channels for DMs and group DMs.
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str | None] = mapped_column(String(100))
    type: Mapped[ChannelType] = mapped_column(
        _str_enum(ChannelType, "channel_type"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # 1:1 DMs only: "<smaller user id>:<larger user id>", so a pair can't end up with two DMs.
    dm_key: Mapped[str | None] = mapped_column(String(73), unique=True)
    # Addon channels only: which addon runs the channel, and its settings (shape set by the addon).
    addon_key: Mapped[str | None] = mapped_column(String(32))
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}", nullable=False)
    # Addon channels only: the text channel where the addon posts its system lines (none = off).
    announce_channel_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("channels.id", ondelete="SET NULL")
    )
    # Group DMs only: the group's picture.
    icon_url: Mapped[str | None] = mapped_column(String(512))
    # The official DM between @aureum and one user (app/bot): read-only, pinned, its own look.
    is_official: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    __table_args__ = (
        CheckConstraint("(type = 'addon') = (addon_key IS NOT NULL)", name="addon_key"),
    )


class ChannelOverride(Base):
    """Allow/deny bits for a role (@everyone included) or a member in one server channel. The
    target has no foreign key since it's either kind; a role's overrides go when the role does."""

    __tablename__ = "channel_permission_overrides"

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True
    )
    target_type: Mapped[OverrideTarget] = mapped_column(
        _str_enum(OverrideTarget, "override_target"), primary_key=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, index=True)
    allow: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    deny: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")


class ChannelMember(Base):
    """Who is in a DM or group DM (server channels use server_members instead)."""

    __tablename__ = "channel_members"

    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    # Closed from the user's DM list; it reopens when a message or a call arrives.
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    joined_at: Mapped[datetime] = _created_at()

    user: Mapped[User] = relationship(lazy="joined")


class Message(Base):
    __tablename__ = "messages"

    # Sequential id: gives a natural, index-friendly cursor for ?before= pagination.
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    attachments: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    created_at: Mapped[datetime] = _created_at()
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set on the line a private call leaves in its DM ("X started a call", "missed call").
    call_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("calls.id", ondelete="SET NULL"))
    # Set on a system line an addon posts (see app.addons.base.AddonChannel.announce):
    # {"addon_key", "source_channel_id", "group", "lines": [...]}. Its content stays empty.
    system: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Set on what @aureum posts (app/bot): {"category", "badge"?}. Kept apart from `system`,
    # which older apps read as an addon line.
    official: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    author: Mapped[User | None] = relationship(lazy="joined")
    call: Mapped["Call | None"] = relationship(lazy="joined")

    __table_args__ = (
        # Covers "latest messages of a channel" and "messages before id X".
        Index("ix_messages_channel_id_id", "channel_id", "id"),
    )


class AttachmentKind(str, enum.Enum):
    image = "image"
    video = "video"
    file = "file"
    # A voice message recorded in the app (Opus/WebM), played with its waveform.
    voice = "voice"


class Attachment(Base):
    """A file sent in a conversation, stored on MinIO. Uploaded first (message_id NULL, only
    the uploader sees it), then attached to the message that sends it. Messages keep a copy of
    the public fields in messages.attachments; this table is what downloads are checked against
    and what cleanup deletes from storage."""

    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = _uuid_pk()
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True, nullable=False
    )
    message_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    uploader_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # Decided from the bytes: images and videos show inline, the rest downloads.
    kind: Mapped[AttachmentKind] = mapped_column(_str_enum(AttachmentKind, "attachment_kind"), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Voice messages: {"duration_ms", "waveform"} as measured by the app while recording.
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class BugReport(Base):
    """A problem reported from the app ("Reportar problema"), read only by the app owner.
    The optional screenshot lives on MinIO and is served by the API to the owner alone."""

    __tablename__ = "bug_reports"

    id: Mapped[uuid.UUID] = _uuid_pk()
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    app_version: Mapped[str] = mapped_column(String(32), nullable=False)
    os: Mapped[str] = mapped_column(String(100), nullable=False)
    # The app's last log lines, with tokens already removed on the device.
    logs: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    screenshot_key: Mapped[str | None] = mapped_column(String(200))
    # "Confirmar bug": it's real and being fixed (the bot says so in the bugs channel).
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # "Fechar (não é bug)": closed without a fix. No badge, no post, no DM.
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()

    author: Mapped[User | None] = relationship(lazy="joined")


class ChannelRead(Base):
    """How far a user has read a channel. Unread = messages with a higher id written by
    someone else. Rows are created when the user joins a server (at the latest message), so
    a newcomer doesn't start with the whole history unread."""

    __tablename__ = "channel_reads"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    last_read_message_id: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    # @username mentions of this user since the last read.
    mention_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class Friendship(Base):
    """A friend request, a friendship or a block between two users.

    Requests and friendships are one row per pair, whoever sent it (requester_id). Blocks are
    one-way: the blocker is the requester, and both people can block each other (two rows).
    """

    __tablename__ = "friendships"

    requester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    addressee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    status: Mapped[FriendshipStatus] = mapped_column(
        _str_enum(FriendshipStatus, "friendship_status"), nullable=False
    )
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        # One request/friendship per pair, in either direction (two crossed requests can't race).
        Index(
            "uq_friendships_pair",
            func.least(text("requester_id"), text("addressee_id")),
            func.greatest(text("requester_id"), text("addressee_id")),
            unique=True,
            postgresql_where=text("status <> 'blocked'"),
        ),
    )


class Call(Base):
    """A private call in a DM or group. It's active (ended_at NULL) while anyone is in it."""

    __tablename__ = "calls"

    id: Mapped[uuid.UUID] = _uuid_pk()
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True, nullable=False
    )
    started_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    started_at: Mapped[datetime] = _created_at()
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    participants: Mapped[list["CallParticipant"]] = relationship(
        lazy="selectin", order_by="CallParticipant.joined_at", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # At most one active call per conversation.
        Index("uq_calls_active_channel", "channel_id", unique=True, postgresql_where=text("ended_at IS NULL")),
    )


class CallParticipant(Base):
    """Someone rung for a call or in it. A row rung but never joined nor declined, once the call
    ended or the ring timed out, is a missed call."""

    __tablename__ = "call_participants"

    call_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calls.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    rung_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # null: wasn't rung (the caller)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    declined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --- Accounts: e-mail codes, account invites, the beta badge's numbers, outgoing e-mail -----


class EmailCodePurpose(str, enum.Enum):
    verify = "verify"  # confirm the sign-up e-mail
    reset = "reset"  # forgot the password
    change_email = "change_email"  # confirm a new address (Configurações › Conta)


class EmailCode(Base):
    """A 6-digit code sent by e-mail; one live code per user and purpose. Only an HMAC of the
    code is kept (app/codes.py)."""

    __tablename__ = "email_codes"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    purpose: Mapped[EmailCodePurpose] = mapped_column(_str_enum(EmailCodePurpose, "email_code_purpose"), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # change_email: the address the code went to, which becomes the account's on success.
    new_email: Mapped[str | None] = mapped_column(String(320))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # When it was (re)sent: a new one can be asked for 60 seconds later.
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AccountInviteKind(str, enum.Enum):
    single = "single"  # one sign-up; each confirmed user gets 3 of these
    group = "group"  # several sign-ups until it runs out or expires (made with the CLI)


class AccountInvite(Base):
    """An invite to create an account while sign-up is invite-only (AUREUM_INVITE_ONLY), shared
    as {PUBLIC_BASE_URL}/convite/{code}. Not to be confused with server invites (Invite), which
    only bring existing accounts into a server."""

    __tablename__ = "account_invites"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    kind: Mapped[AccountInviteKind] = mapped_column(_str_enum(AccountInviteKind, "account_invite_kind"), nullable=False)
    # Whose invite it is; NULL for the ones made with the CLI.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False)
    # Counted when the invited person confirms their e-mail, not at sign-up.
    uses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()

    owner: Mapped[User | None] = relationship(lazy="joined")


class AccountInviteUse(Base):
    """Who signed up with which invite (so, who invited whom). The invite's use is counted when
    the account confirms its e-mail (confirmed_at)."""

    __tablename__ = "account_invite_uses"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    code: Mapped[str] = mapped_column(ForeignKey("account_invites.code", ondelete="CASCADE"), index=True, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(lazy="joined")


class PioneerNumber(Base):
    """Every number of the beta badge ever reserved or handed out. Rows are never deleted (the
    links go NULL with the account or invite), so no number is ever given twice. New numbers
    come from the pioneer_number_seq sequence, skipping the ones already here (app/badges.py)."""

    __tablename__ = "pioneer_numbers"

    number: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    # Who holds it, or is meant to get it on confirming their e-mail (CLI --pioneiro N).
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), unique=True)
    # Reserved for whoever signs up with this invite (CLI invites create --pioneiro N).
    invite_code: Mapped[str | None] = mapped_column(ForeignKey("account_invites.code", ondelete="SET NULL"), unique=True)
    created_at: Mapped[datetime] = _created_at()


class UserDevice(Base):
    """An app install that has signed in to the account, to tell a new sign-in apart (the
    official DM's security notice). Only a hash of the id the app generates is kept; no IP."""

    __tablename__ = "user_devices"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    device_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    first_seen: Mapped[datetime] = _created_at()


# --- The official bot, @aureum (app/bot) ------------------------------------------------


class BotAction(Base):
    """Each bot action, switched on and off with the CLI (off until switched on). Server
    actions also need their channel."""

    __tablename__ = "bot_actions"

    action: Mapped[str] = mapped_column(String(32), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    channel_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("channels.id", ondelete="SET NULL"))


class BotWelcome(Base):
    """Who got the welcome in which official server: at most once, even after leaving."""

    __tablename__ = "bot_welcomes"

    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = _created_at()


class BotRelease(Base):
    """An app release (GitHub tag) the bot already announced: each one once."""

    __tablename__ = "bot_releases"

    tag: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = _created_at()


class BotDelivery(Base):
    """An official DM a user already got, by a key naming what it was ("badge:pioneer",
    "broadcast:<hash>", ...): the same one never goes twice."""

    __tablename__ = "bot_deliveries"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    created_at: Mapped[datetime] = _created_at()


class BotOutbox(Base):
    """A broadcast DM waiting to go out (sent by a worker at a steady pace). Unique per user and
    key, so running the same broadcast again only queues who's still missing."""

    __tablename__ = "bot_outbox"
    __table_args__ = (
        UniqueConstraint("user_id", "key"),
        Index("ix_bot_outbox_due", "id", postgresql_where=text("sent_at IS NULL")),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OutboxEmail(Base):
    """An e-mail waiting to go out (app/mail). Sent rows are deleted; after the last failed try
    the row stays for the record without its params (codes) and with the address masked."""

    __tablename__ = "email_outbox"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    to_address: Mapped[str] = mapped_column(String(320), nullable=False)
    template: Mapped[str] = mapped_column(String(32), nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        Index("ix_email_outbox_due", "next_attempt_at", postgresql_where=text("failed_at IS NULL")),
    )
