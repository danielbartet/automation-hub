"""Content post model — tracks generated and published content."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class ContentPost(Base):
    """A piece of generated or published social media content."""

    __tablename__ = "content_posts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    format: Mapped[str] = mapped_column(String(50), nullable=False, default="carousel")  # carousel, single_image, text
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_urls: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # single image URL
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # generated video URL
    content: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # raw generated content
    status: Mapped[str] = mapped_column(String(50), default="pending_approval", nullable=False)
    # draft | pending_approval | approved | rejected | published | failed
    instagram_media_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    facebook_post_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    batch_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
