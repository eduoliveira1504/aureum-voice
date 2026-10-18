import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

# Where a column stands in the work; the overview's progress counts cards by it.
STAGES = ("todo", "doing", "done")
# Label colors are names of the app's label tokens (--label-<color>), never raw colors.
LABEL_COLORS = ("gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink")

# Every table hangs off `workspace_id` with no foreign key on purpose: the board doesn't depend on
# what hosts it (today an addon channel). The registry's cleanup removes a workspace's rows.


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _workspace() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), nullable=False, index=True)


def _timestamp() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class KanbanColumn(Base):
    __tablename__ = "addon_kanban_columns"

    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = _workspace()
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    stage: Mapped[str] = mapped_column(String(8), nullable=False, default="todo", server_default="todo")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    __table_args__ = (CheckConstraint(f"stage IN {STAGES}", name="stage"),)


class KanbanLabel(Base):
    __tablename__ = "addon_kanban_labels"

    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = _workspace()
    name: Mapped[str] = mapped_column(String(30), nullable=False)
    color: Mapped[str] = mapped_column(String(12), nullable=False, default="gray", server_default="gray")

    __table_args__ = (CheckConstraint(f"color IN {LABEL_COLORS}", name="color"),)


class KanbanCard(Base):
    __tablename__ = "addon_kanban_cards"

    id: Mapped[uuid.UUID] = _uuid_pk()
    workspace_id: Mapped[uuid.UUID] = _workspace()
    column_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("addon_kanban_columns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Ids of labels of the same workspace; a deleted label is taken out of every card.
    label_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _timestamp()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class KanbanEvent(Base):
    """The board's history: who did what. Names and titles are copied into `data`, so entries
    still read well after the card or column is gone (hence no foreign key on card_id)."""

    __tablename__ = "addon_kanban_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    card_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = _timestamp()

    __table_args__ = (
        Index("ix_addon_kanban_events_workspace_id_id", "workspace_id", "id"),
        Index("ix_addon_kanban_events_card_id_id", "card_id", "id"),
    )
