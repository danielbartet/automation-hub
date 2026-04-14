"""Token usage tracking models."""
from datetime import datetime
from sqlalchemy import DateTime, Float, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class TokenUsageLog(Base):
    __tablename__ = "token_usage_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    tokens_input: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_output: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_cached: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    operation_type: Mapped[str] = mapped_column(String(50), nullable=False)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), index=True
    )

    __table_args__ = (
        Index("ix_token_usage_log_user_created", "user_id", "created_at"),
        Index("ix_token_usage_log_project_created", "project_id", "created_at"),
    )


class UserTokenLimit(Base):
    __tablename__ = "user_token_limits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, index=True)
    monthly_token_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
