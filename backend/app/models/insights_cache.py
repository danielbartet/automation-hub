"""Campaign insights cache — avoids hammering Meta API on every dashboard load."""
from datetime import datetime, timezone
from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class CampaignInsightsCache(Base):
    """Caches Meta campaign insights responses for up to 1 hour per (campaign, date_preset) pair.

    Reduces ADS_INSIGHTS BUC points consumption on the dashboard and campaign detail page.
    TTL is 1 hour — set in expires_at at write time.
    """

    __tablename__ = "campaign_insights_cache"
    __table_args__ = (
        UniqueConstraint("campaign_id", "date_preset", name="uq_campaign_insights_preset"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Meta campaign ID string (not local DB id)
    campaign_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # "last_7d" | "last_30d" | "this_month"
    date_preset: Mapped[str] = mapped_column(String(32), nullable=False)
    # Full JSON-serialised insights payload (summary + daily rows)
    data: Mapped[str] = mapped_column(String, nullable=False)
    cached_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
    )
