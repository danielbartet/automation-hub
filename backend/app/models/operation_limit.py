"""Per-user operation throttling models."""
from datetime import datetime, timezone
from sqlalchemy import DateTime, Index, Integer, String, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class UserOperationLimit(Base):
    """Per-user operation limits and plan tier."""

    __tablename__ = "user_operation_limits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, index=True)
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="basic")

    # Content post limits
    max_posts_per_min: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    max_posts_per_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    max_posts_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    min_post_interval_min: Mapped[int] = mapped_column(Integer, nullable=False, default=2)

    # Campaign limits
    max_campaigns_per_min: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    max_campaigns_per_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    max_campaigns_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    min_campaign_interval_min: Mapped[int] = mapped_column(Integer, nullable=False, default=5)

    # Meta API usage cap
    meta_usage_cap_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=40)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class UserOperationLog(Base):
    """Log of user operations for throttle window checks."""

    __tablename__ = "user_operation_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), nullable=False, index=True
    )
    # "content_post" | "campaign_create"
    operation_type: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False,
        index=True,
    )

    __table_args__ = (
        Index(
            "ix_user_op_logs_user_type_created",
            "user_id",
            "operation_type",
            "created_at",
        ),
    )
