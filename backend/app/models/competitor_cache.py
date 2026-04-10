"""Competitor research cache model — stores cached Meta Ad Library results per project."""
from datetime import datetime
from typing import TYPE_CHECKING, Optional
from sqlalchemy import DateTime, ForeignKey, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

if TYPE_CHECKING:
    from app.models.project import Project


class CompetitorResearchCache(Base):
    """Caches competitor ad data from Meta Ad Library (TTL: 48 hours)."""

    __tablename__ = "competitor_research_cache"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id"), nullable=False, unique=True, index=True
    )
    research_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    project: Mapped["Project"] = relationship("Project", back_populates="competitor_cache")
