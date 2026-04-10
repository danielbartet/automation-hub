"""Project model — one row per managed project/niche."""
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Project(Base):
    """Represents a managed project (e.g. Quantoria Labs)."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)  # Fernet encrypted
    meta_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    facebook_page_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    instagram_account_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ad_account_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    content_config: Mapped[dict | None] = mapped_column(JSON, nullable=True, default={})
    media_config: Mapped[dict | None] = mapped_column(JSON, nullable=True, default={})
    owner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    credits_balance: Mapped[int] = mapped_column(Integer, default=1000, nullable=False)
    credits_used_this_month: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
