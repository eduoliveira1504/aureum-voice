import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

# A poll lives in a chat (`workspace_id`, no foreign key, like every addon) and is shown by one
# message there. The message is its host: deleting it (or its channel) deletes the poll, so that
# one key does have a foreign key.


class Poll(Base):
    __tablename__ = "addon_polls_polls"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    question: Mapped[str] = mapped_column(String(300), nullable=False)
    multiple: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    anonymous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # When it closes by itself; None: open until someone closes it.
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set once closed, by hand or by the deadline (then it's closes_at).
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        # The deadline worker's lookup: open polls with a deadline.
        Index("ix_addon_polls_polls_due", "closes_at", postgresql_where="closed_at IS NULL AND closes_at IS NOT NULL"),
    )


class PollOption(Base):
    __tablename__ = "addon_polls_options"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    poll_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("addon_polls_polls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(String(80), nullable=False)
    emoji: Mapped[str | None] = mapped_column(String(16))


class PollVote(Base):
    __tablename__ = "addon_polls_votes"

    option_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("addon_polls_options.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Repeated from the option, so a person's votes in a poll are one indexed lookup.
    poll_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("addon_polls_polls.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_addon_polls_votes_poll_id_user_id", "poll_id", "user_id"),)
