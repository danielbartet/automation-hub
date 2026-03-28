"""Approval model — tracks Telegram-based approval flows."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Approval(Base):
    """An approval request sent via Telegram for a content post."""

    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    content_post_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_posts.id"), nullable=False, index=True
    )
    telegram_message_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending", nullable=False)
    # pending | approved | rejected | expired
    reviewer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
