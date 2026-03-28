"""ContentBatch model — tracks bulk content generation runs."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class ContentBatch(Base):
    """A batch of content posts generated for a scheduled period."""

    __tablename__ = "content_batches"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    count_requested: Mapped[int] = mapped_column(Integer, nullable=False)
    count_generated: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(50), default="pending")  # pending, complete, failed
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
