"""Competitor Intelligence Brief model — stores weekly competitive analysis per project."""
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from sqlalchemy import DateTime, ForeignKey, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

if TYPE_CHECKING:
    from app.models.project import Project


class CompetitorIntelligenceBrief(Base):
    """Stores the weekly Claude-generated competitive intelligence brief for a project."""

    __tablename__ = "competitor_intelligence_briefs"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id"), nullable=False, index=True
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False,
    )
    analyzed_ads_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    brief: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    project: Mapped["Project"] = relationship("Project", back_populates="competitor_briefs")
