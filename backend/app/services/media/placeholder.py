"""Placeholder image provider — generates a simple branded PNG via Pillow and uploads to S3."""
import io
import logging
from datetime import datetime

from PIL import Image, ImageDraw

from app.services.media.base import BaseImageProvider

logger = logging.getLogger(__name__)


class PlaceholderProvider(BaseImageProvider):
    """Fallback image provider that generates a minimal placeholder using Pillow."""

    async def generate_image(
        self,
        prompt: str,
        media_config: dict = {},
        # Legacy params kept for backward compatibility — prefer media_config
        style: str = "typographic",
        aspect_ratio: str = "1:1",
        color_palette: str = "dark",
    ) -> str:
        """Generate a simple placeholder image, upload to S3, and return its public URL."""
        # Import here to avoid circular dependency at module level
        from app.services.storage.s3 import S3Service

        # Determine dimensions from aspect ratio
        ratio_sizes = {
            "1:1": (1080, 1080),
            "4:5": (1080, 1350),
            "9:16": (1080, 1920),
            "16:9": (1920, 1080),
        }
        width, height = ratio_sizes.get(aspect_ratio, (1080, 1080))

        img = Image.new("RGB", (width, height), color=(15, 15, 15))
        draw = ImageDraw.Draw(img)

        # Truncate prompt so it fits reasonably
        label = prompt[:60] + "..." if len(prompt) > 60 else prompt
        draw.text((width // 2, height // 2), label, fill=(255, 255, 255), anchor="mm")

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        key = f"generated/images/{timestamp}_placeholder.png"

        s3_service = S3Service()
        s3_service.s3.upload_fileobj(buffer, s3_service.bucket, key)
        url = f"https://{s3_service.bucket}.s3.amazonaws.com/{key}"
        logger.info("PlaceholderProvider uploaded placeholder image: %s", url)
        return url
