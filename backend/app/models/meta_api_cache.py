"""MetaApiCache and AuditLog models."""
from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON
from app.core.database import Base


class MetaApiCache(Base):
    """Cache for Meta API responses to reduce API calls and handle failures gracefully."""

    __tablename__ = "meta_api_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    cache_key: Mapped[str] = mapped_column(String(100), nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    ttl_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=900)

    @property
    def is_valid(self) -> bool:
        """Returns True if cache entry is within TTL."""
        age = (datetime.now(timezone.utc).replace(tzinfo=None) - self.fetched_at).total_seconds()
        return age < self.ttl_seconds


class AuditLog(Base):
    """Audit log for API calls and system events."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("projects.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(200), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(500), nullable=False)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, server_default=func.now())
