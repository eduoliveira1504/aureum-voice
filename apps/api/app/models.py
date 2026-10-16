"""Database models. Every table from the data model lives here so the schema is
created in full, including tables that later phases will use (oauth_accounts, DMs)."""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
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


class MemberRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"


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


class ChannelType(str, enum.Enum):
    text = "text"
    voice = "voice"
    dm = "dm"
    group_dm = "group_dm"


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
    accent_color: Mapped[str | None] = mapped_column(String(7))  # "#rrggbb"
    created_at: Mapped[datetime] = _created_at()


DEFAULT_ACCENT = "#E8B531"  # Aureum gold


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
    # Open panels per server id (see schemas.PanelLayout).
    panel_layouts: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
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
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    created_at: Mapped[datetime] = _created_at()


class ServerMember(Base):
    __tablename__ = "server_members"

    server_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[MemberRole] = mapped_column(
        _str_enum(MemberRole, "member_role"), default=MemberRole.member, nullable=False
    )
    joined_at: Mapped[datetime] = _created_at()

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

    author: Mapped[User | None] = relationship(lazy="joined")
    call: Mapped["Call | None"] = relationship(lazy="joined")

    __table_args__ = (
        # Covers "latest messages of a channel" and "messages before id X".
        Index("ix_messages_channel_id_id", "channel_id", "id"),
    )


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
