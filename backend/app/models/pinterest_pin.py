"""PinterestPin model — one row per generated/published Pinterest pin."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class PinterestPin(Base):
    """Represents a Pinterest pin generated and optionally published by the platform."""

    __tablename__ = "pinterest_pins"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    layout: Mapped[str] = mapped_column(String(50), nullable=False, server_default="bottom")
    topic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    board_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pinterest_pin_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, server_default="pending_approval")
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
