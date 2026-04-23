"""Pinterest pin generator skill — Google Imagen 4 + Pillow overlay + S3 upload."""
import io
import logging
import re
import uuid

import httpx
from PIL import Image

from app.core.config import settings
from app.models.project import Project
from app.services.claude.client import ClaudeClient
from app.services.storage.s3 import S3Service
from app.skills.base import BaseSkill
from app.skills.pinterest_pin_generator.layouts import apply_overlay

logger = logging.getLogger(__name__)

_WEBSITE_FETCH_TIMEOUT = 5.0
_WEBSITE_MAX_CHARS = 1500


async def _fetch_website_snippet(url: str) -> str:
    """Fetch the homepage of a URL and extract a short text snippet.

    Returns an empty string on any error (never raises).
    """
    if not url:
        return ""
    # Ensure scheme
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        async with httpx.AsyncClient(timeout=_WEBSITE_FETCH_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; AutomationHub/1.0)"})
            if not resp.is_success:
                return ""
            html = resp.text

        # Extract <title>
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        title_text = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else ""

        # Extract meta description
        meta_match = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)["\']',
            html,
            re.IGNORECASE,
        )
        if not meta_match:
            meta_match = re.search(
                r'<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']description["\']',
                html,
                re.IGNORECASE,
            )
        meta_text = meta_match.group(1).strip() if meta_match else ""

        # Extract first 3 <p> texts
        p_matches = re.findall(r"<p[^>]*>(.*?)</p>", html, re.IGNORECASE | re.DOTALL)
        p_texts = []
        for p in p_matches[:3]:
            clean = re.sub(r"<[^>]+>", "", p).strip()
            if len(clean) > 20:
                p_texts.append(clean)

        parts = [p for p in [title_text, meta_text] + p_texts if p]
        snippet = " | ".join(parts)
        return snippet[:_WEBSITE_MAX_CHARS]
    except Exception as exc:
        logger.debug("Website snippet fetch failed for %s: %s", url, exc)
        return ""


# Aspect ratio mapping: image_size -> Imagen 4 aspect_ratio string
_ASPECT_RATIO_MAP = {
    "1000x1500": "9:16",
    "1000x1000": "1:1",
    "600x900": "9:16",
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
        self.claude = ClaudeClient()

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
                "layout": str,            # "bottom" | "split" | "center" | "badge_bottom"
                "title": str | None,      # manual override (optional)
                "description": str | None, # manual override (optional)
                "image_size": str,        # "1000x1500" | "1000x1000" | "600x900"
                "content_config": dict | None,
                "media_config": dict | None,
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
        title_override = payload.get("title") or ""
        desc_override = payload.get("description") or ""
        image_size = payload.get("image_size", "1000x1500")
        content_config: dict = payload.get("content_config") or {}
        media_config: dict = payload.get("media_config") or {}

        # ── Resolve brand colors from project config ───────────────────────────
        primary_color = (
            content_config.get("brand_primary_color")
            or media_config.get("image_primary_color")
            or "#7c3aed"
        )
        bg_color = content_config.get("brand_bg_color") or "#050505"

        brand_colors = {
            "primary": primary_color,
            "bg": bg_color,
        }

        aspect_ratio = _ASPECT_RATIO_MAP.get(image_size, "2:3")
        dimensions = _DIMENSION_MAP.get(image_size, (1000, 1500))

        # ── Step 1: Fetch website snippet (silently skip on failure) ───────────
        website_url = content_config.get("image_cta_url") or content_config.get("landing_url") or content_config.get("website_url") or ""
        website_snippet = await _fetch_website_snippet(website_url)

        # ── Step 2: Claude enrichment ──────────────────────────────────────────
        imagen_prompt = topic  # fallback: use raw topic
        claude_title = ""
        claude_description = ""

        try:
            enriched = await self.claude.enrich_pinterest_pin(
                topic=topic,
                content_config=content_config,
                website_snippet=website_snippet,
            )
            imagen_prompt = enriched.get("imagen_prompt") or topic
            claude_title = enriched.get("title") or ""
            claude_description = enriched.get("description") or ""
            logger.info("Claude enriched Pinterest pin for topic: %r", topic)
        except Exception as exc:
            logger.warning("Claude enrichment failed, using raw topic as Imagen prompt: %s", exc)

        # Resolve final title and description: manual override takes precedence
        title = title_override if title_override else (claude_title or topic)
        description = desc_override if desc_override else claude_description

        # ── Step 3: Generate base image with Imagen 4 ──────────────────────────
        image_bytes: bytes | None = None
        status = "success"

        if settings.GEMINI_API_KEY:
            try:
                from google import genai
                from google.genai.types import GenerateImagesConfig

                full_prompt = (
                    f"{imagen_prompt}. "
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
                logger.info("Imagen 4 generated image for enriched prompt (topic: %r)", topic)
            except Exception as exc:
                logger.warning("Imagen 4 generation failed, using fallback canvas: %s", exc)
                image_bytes = None
                status = "fallback"
        else:
            logger.warning("GEMINI_API_KEY not configured — using fallback canvas")
            status = "fallback"

        # ── Step 4: Fallback solid-color canvas ────────────────────────────────
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

        # ── Step 5: Apply text overlay ─────────────────────────────────────────
        composited_bytes = apply_overlay(
            base_image=image_bytes,
            title=title,
            description=description,
            layout=layout,
            brand_colors=brand_colors,
        )

        # ── Step 6: Upload to S3 ───────────────────────────────────────────────
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
