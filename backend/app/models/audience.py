"""Audience model — tracks Meta custom audiences per project."""
from datetime import datetime
from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Audience(Base):
    """A Meta custom audience linked to a project."""

    __tablename__ = "audiences"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    meta_audience_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # website | customer_list | engagement | lookalike
    subtype: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # WEBSITE | CUSTOM | LOOKALIKE | ENGAGEMENT
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="processing", nullable=False)
    # processing | ready | error
    source_audience_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # DB id of source audience (for lookalike)
    lookalike_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    lookalike_countries: Mapped[list | None] = mapped_column(JSON, nullable=True)
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
