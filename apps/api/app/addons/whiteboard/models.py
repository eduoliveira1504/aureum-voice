import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base

BACKGROUNDS = ("plain", "grid")

# Every table hangs off `workspace_id` with no foreign key on purpose: the whiteboard doesn't depend
# on what hosts it (today an addon channel). The registry's cleanup removes a workspace's rows.


def _workspace() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), nullable=False, index=True)


def _timestamp() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class WhiteboardBoard(Base):
    """One drawing. The scene is Excalidraw's element list, kept as {element id: element} so
    edits merge per element (the higher element version wins). Deleted elements stay as
    tombstones (isDeleted), so a late edit can't bring them back."""

    __tablename__ = "addon_whiteboard_boards"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = _workspace()
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    elements: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    background: Mapped[str] = mapped_column(String(8), nullable=False, default="plain", server_default="plain")
    # Goes up on every saved change; clients use it to tell a newer scene from their own.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Size of the scene as JSON, checked against the limit on every save.
    scene_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # A small PNG of the scene for the list and the overview, rendered by the client.
    thumbnail_key: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _timestamp()
    # When the scene or the name last changed (not the thumbnail).
    updated_at: Mapped[datetime] = _timestamp()
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # When the last version (snapshot) was kept; the next one comes after SNAPSHOT_EVERY of edits.
    snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (CheckConstraint(f"background IN {BACKGROUNDS}", name="background"),)


class WhiteboardSnapshot(Base):
    """A saved version of a board, for "Restaurar esta versão". The last MAX_SNAPSHOTS are kept."""

    __tablename__ = "addon_whiteboard_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    board_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("addon_whiteboard_boards.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[uuid.UUID] = _workspace()
    elements: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    background: Mapped[str] = mapped_column(String(8), nullable=False)
    # Who had edited it last when it was kept.
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _timestamp()

    __table_args__ = (Index("ix_addon_whiteboard_snapshots_board_id_id", "board_id", "id"),)


class WhiteboardFile(Base):
    """An image placed on a board. The bytes live in object storage; scenes only carry the
    file id (Excalidraw's, a hash of the content), never the image itself. Files belong to the
    workspace, so a duplicated board shares them."""

    __tablename__ = "addon_whiteboard_files"

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    file_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    content_type: Mapped[str] = mapped_column(String(40), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _timestamp()
