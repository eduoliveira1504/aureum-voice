"""Database models. Every table from the data model lives here so the schema is
created in full, including tables that later phases will use (oauth_accounts, DMs)."""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
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

    author: Mapped[User | None] = relationship(lazy="joined")

    __table_args__ = (
        # Covers "latest messages of a channel" and "messages before id X".
        Index("ix_messages_channel_id_id", "channel_id", "id"),
    )
