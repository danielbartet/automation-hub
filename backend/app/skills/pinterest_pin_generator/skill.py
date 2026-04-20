"""Pinterest pin generator skill — Google Imagen 4 + Pillow overlay + S3 upload."""
import io
import logging
import uuid

from PIL import Image

from app.core.config import settings
from app.models.project import Project
from app.services.storage.s3 import S3Service
from app.skills.base import BaseSkill
from app.skills.pinterest_pin_generator.layouts import apply_overlay

logger = logging.getLogger(__name__)

# Aspect ratio mapping: image_size -> Imagen 4 aspect_ratio string
_ASPECT_RATIO_MAP = {
    "1000x1500": "2:3",
    "1000x1000": "1:1",
    "600x900": "2:3",
}

# Dimension mapping: image_size -> (width, height) for fallback canvas
_DIMENSION_MAP = {
    "1000x1500": (1000, 1500),
    "1000x1000": (1000, 1000),
    "600x900": (600, 900),
}


class PinterestPinGeneratorSkill(BaseSkill):
    """Generates a Pinterest pin image using Google Imagen 4 + Pillow overlay."""

    def __init__(self, project: Project) -> None:
        super().__init__(project)
        self.s3 = S3Service()

    @property
    def name(self) -> str:
        return "pinterest_pin_generator"

    @property
    def description(self) -> str:
        return "Generate a Pinterest pin image using Google Imagen 4 and Pillow overlay"

    async def execute(self, payload: dict) -> dict:
        """Generate a Pinterest pin image with overlay and upload to S3.

        Args:
            payload: {
                "topic": str,
                "layout": str,         # "bottom" | "split" | "center" | "badge_bottom"
                "title": str | None,
                "description": str | None,
                "image_size": str,     # "1000x1500" | "1000x1000" | "600x900"
                "brand_colors": dict | None
            }

        Returns:
            {
                "image_bytes": bytes,
                "image_url": str,
                "title": str,
                "description": str,
                "layout": str,
                "status": "success" | "fallback"
            }
        """
        topic = payload.get("topic", "")
        layout = payload.get("layout", "bottom")
        title = payload.get("title") or topic
        description = payload.get("description") or ""
        image_size = payload.get("image_size", "1000x1500")
        brand_colors = payload.get("brand_colors") or {}

        brand_colors.setdefault("primary", "#7c3aed")
        brand_colors.setdefault("bg", "#050505")

        aspect_ratio = _ASPECT_RATIO_MAP.get(image_size, "2:3")
        dimensions = _DIMENSION_MAP.get(image_size, (1000, 1500))

        # ── Step 1: Generate base image with Imagen 4 ──────────────────────────
        image_bytes: bytes | None = None
        status = "success"

        if settings.GEMINI_API_KEY:
            try:
                from google import genai
                from google.genai.types import GenerateImagesConfig

                full_prompt = (
                    f"{topic}. "
                    "Photorealistic, 4K quality, no text, no labels, no writing, no signs anywhere in the image."
                )

                client = genai.Client(api_key=settings.GEMINI_API_KEY)
                response = client.models.generate_images(
                    model="imagen-4.0-generate-001",
                    prompt=full_prompt,
                    config=GenerateImagesConfig(
                        number_of_images=1,
                        aspect_ratio=aspect_ratio,
                        output_mime_type="image/png",
                    ),
                )
                image_bytes = response.generated_images[0].image.image_bytes
                logger.info("Imagen 4 generated image for topic: %r", topic)
            except Exception as exc:
                logger.warning("Imagen 4 generation failed, using fallback canvas: %s", exc)
                image_bytes = None
                status = "fallback"
        else:
            logger.warning("GEMINI_API_KEY not configured — using fallback canvas")
            status = "fallback"

        # ── Step 2: Fallback solid-color canvas ────────────────────────────────
        if image_bytes is None:
            status = "fallback"
            width, height = dimensions
            bg_hex = brand_colors.get("bg", "#050505")
            try:
                r = int(bg_hex.lstrip("#")[0:2], 16)
                g = int(bg_hex.lstrip("#")[2:4], 16)
                b = int(bg_hex.lstrip("#")[4:6], 16)
            except (ValueError, IndexError):
                r, g, b = 5, 5, 5
            fallback_img = Image.new("RGB", (width, height), color=(r, g, b))
            buf = io.BytesIO()
            fallback_img.save(buf, format="PNG")
            image_bytes = buf.getvalue()

        # ── Step 3: Apply text overlay ─────────────────────────────────────────
        composited_bytes = apply_overlay(
            base_image=image_bytes,
            title=title,
            description=description,
            layout=layout,
            brand_colors=brand_colors,
        )

        # ── Step 4: Upload to S3 ───────────────────────────────────────────────
        project_slug = self.project.slug if hasattr(self.project, "slug") else "pinterest"
        unique_id = uuid.uuid4().hex
        image_url = await self._upload_pin(composited_bytes, project_slug, unique_id)

        return {
            "image_bytes": composited_bytes,
            "image_url": image_url,
            "title": title,
            "description": description,
            "layout": layout,
            "status": status,
        }

    async def _upload_pin(self, data: bytes, project_slug: str, unique_id: str) -> str:
        """Upload pin image bytes to S3 at a predictable path and return the public URL."""
        key = f"pinterest/{project_slug}/{unique_id}.png"
        self.s3.s3.put_object(
            Bucket=self.s3.bucket,
            Key=key,
            Body=data,
            ContentType="image/png",
        )
        return f"https://{self.s3.bucket}.s3.amazonaws.com/{key}"
