"""AdsAudit and AuditCheckResult models — tracks Meta Ads health audit runs and per-check results."""
from datetime import datetime
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from app.core.database import Base


class AdsAudit(Base):
    """A Meta Ads health audit run for a given ad account."""

    __tablename__ = "ads_audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    ad_account_id: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    # running | completed | partial | error | failed
    health_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    grade: Mapped[str | None] = mapped_column(String(2), nullable=True)
    # A | B | C | D | F
    score_pixel: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_creative: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_structure: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_audience: Mapped[float | None] = mapped_column(Float, nullable=True)
    checks_pass: Mapped[int] = mapped_column(Integer, default=0)
    checks_warning: Mapped[int] = mapped_column(Integer, default=0)
    checks_fail: Mapped[int] = mapped_column(Integer, default=0)
    checks_manual: Mapped[int] = mapped_column(Integer, default=0)
    checks_na: Mapped[int] = mapped_column(Integer, default=0)
    ios_disclaimer: Mapped[bool] = mapped_column(Boolean, default=True)
    triggered_by: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    # manual | scheduler
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # compact {check_id: {meta_value, threshold_value}}
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    check_results: Mapped[list["AuditCheckResult"]] = relationship(
        "AuditCheckResult",
        back_populates="audit",
        cascade="all, delete-orphan",
    )


class AuditCheckResult(Base):
    """A single check result within a Meta Ads health audit."""

    __tablename__ = "audit_check_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    audit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("ads_audits.id", ondelete="CASCADE"), nullable=False, index=True
    )
    check_id: Mapped[str] = mapped_column(String(20), nullable=False)
    # e.g. M01, C03, S05, A02
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    # pixel | creative | structure | audience
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    # Critical | High | Medium | Low
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    # PASS | WARNING | FAIL | MANUAL_REQUIRED | NA
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[str] = mapped_column(Text, default="")
    meta_value: Mapped[str] = mapped_column(String(255), default="")
    threshold_value: Mapped[str] = mapped_column(String(255), default="")
    meta_ui_link: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    audit: Mapped["AdsAudit"] = relationship("AdsAudit", back_populates="check_results")
