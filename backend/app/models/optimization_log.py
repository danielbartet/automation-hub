"""Campaign optimization log model — records every optimizer decision."""
from datetime import datetime
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class CampaignOptimizationLog(Base):
    """Records each autonomous optimization check and action taken."""

    __tablename__ = "campaign_optimization_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    campaign_id: Mapped[int] = mapped_column(Integer, ForeignKey("ad_campaigns.id"), nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    metrics_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON string
    decision: Mapped[str | None] = mapped_column(String(20), nullable=True)    # SCALE | MODIFY | PAUSE | KEEP
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_taken: Mapped[str | None] = mapped_column(String(20), nullable=True)
    old_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    new_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    creative_refreshed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")
    new_creative_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
