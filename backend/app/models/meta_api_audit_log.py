"""Meta API Audit Log model — records every write operation sent to the Meta Graph API."""
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.user import User


class MetaAPIAuditLog(Base):
    """Immutable audit trail of all Meta Graph API write operations."""

    __tablename__ = "meta_api_audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("projects.id"), nullable=False, index=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False,
        index=True,
    )
    # Operation type: publish_post | create_campaign | update_budget | pause_campaign |
    #                 activate_campaign | upload_image
    operation: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Entity type: post | campaign | ad | budget
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # Meta's external ID for the entity (nullable when not available at log time)
    entity_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Sanitised request payload (tokens/secrets stripped)
    payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # HTTP status code returned by Meta Graph API
    response_status: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    project: Mapped["Project"] = relationship("Project", back_populates="meta_audit_logs")


class MetaAppUsage(Base):
    """App-level X-App-Usage snapshots recorded after every Meta API call."""

    __tablename__ = "meta_app_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False,
    )
    # Percentage values parsed from X-App-Usage or X-Business-Use-Case-Usage headers
    call_count_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_time_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_cputime_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Max of the three percentages above — used for status determination
    max_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
