import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

REPEATS = ("none", "weekly")
RESPONSES = ("going", "maybe", "no")

# Every table hangs off `workspace_id` with no foreign key, like every addon; the registry's
# cleanup removes a workspace's rows. The voice room an event happens in is a channel of the
# host, kept without a foreign key for the same reason.


class Event(Base):
    __tablename__ = "addon_events_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # The first occurrence.
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # The IANA zone the times were picked in: a weekly event keeps its wall-clock time there.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    repeat: Mapped[str] = mapped_column(String(8), nullable=False, default="none", server_default="none")
    # Where: a voice room of the host, or free text (or neither).
    location_channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    location_text: Mapped[str | None] = mapped_column(String(200))
    cover_key: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    # Called off: still shown (as cancelled), no reminders, no more answers.
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(f"repeat IN {REPEATS}", name="repeat"),
        CheckConstraint("ends_at > starts_at", name="ends_after_start"),
    )


class EventResponse(Base):
    """Vou / Talvez / Não vou, per occurrence: a weekly event's answers start over every week
    (occurrence 0 is the first, 1 a week later...)."""

    __tablename__ = "addon_events_responses"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("addon_events_events.id", ondelete="CASCADE"), primary_key=True
    )
    occurrence: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (CheckConstraint(f"status IN {RESPONSES}", name="status"),)
