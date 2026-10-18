import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class NotesPage(Base):
    """One shared page per workspace (an addon channel). The workspace has no foreign key on
    purpose: addons don't depend on channels; the registry's cleanup removes the page."""

    __tablename__ = "addon_notes_pages"

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # Bumped on every save, so two people editing at once can't silently overwrite each other.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
