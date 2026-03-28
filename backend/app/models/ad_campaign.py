"""Ad campaign model — tracks Meta Ads campaigns per project."""
from datetime import datetime
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AdCampaign(Base):
    """A Meta Ads campaign linked to a project."""

    __tablename__ = "ad_campaigns"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    meta_campaign_id: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True)
    meta_adset_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    meta_ad_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    meta_creative_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ad_account_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    facebook_page_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="paused", nullable=False)
    # active | paused | archived
    daily_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    lifetime_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    ad_copy: Mapped[str | None] = mapped_column(Text, nullable=True)
    destination_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    countries: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array as string
    last_optimized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
