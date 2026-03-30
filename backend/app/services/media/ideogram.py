"""Ideogram image generation provider."""
import logging

import httpx
from fastapi import HTTPException

from app.core.config import settings
from app.services.media.base import BaseImageProvider

logger = logging.getLogger(__name__)


class IdeogramProvider(BaseImageProvider):
    """Generates images via the Ideogram v2 API and stores them in S3."""

    BASE_URL = "https://api.ideogram.ai"

    RATIO_MAP = {
        "1:1": "ASPECT_1_1",
        "4:5": "ASPECT_4_5",
        "9:16": "ASPECT_9_16",
        "16:9": "ASPECT_16_9",
    }

    STYLE_MAP = {
        "typographic": "DESIGN",
        "photorealistic": "REALISTIC",
        "illustration": "GENERAL",
        "minimal": "DESIGN",
        "data_visual": "DESIGN",
    }

    # Legacy palette prompts kept for backward compatibility
    COLOR_PROMPTS = {
        "dark_purple": "dark background #0f0a19, neon purple accent #7c3aed, white typography",
        "dark_green": "dark background #0a140f, neon green accent #22c55e, white typography",
        "dark_blue": "dark background #0a0f19, electric blue accent #3b82f6, white typography",
        "dark_orange": "dark background #140c05, orange accent #f97316, white typography",
        "dark": "dark background #0a0a0a, white typography, minimal design",
    }

    def __init__(self) -> None:
        self.api_key = settings.IDEOGRAM_API_KEY

    def build_prompt(self, content_prompt: str, media_config: dict) -> str:
        """Build a rich prompt from content_prompt and brand media_config."""
        primary = media_config.get("image_primary_color", "#7c3aed")
        secondary = media_config.get("image_secondary_color", "#00FF41")
        bg = media_config.get("image_bg_color", "#0a0a0a")
        mood = media_config.get("image_mood", "dark, professional, tech")
        fonts = media_config.get("image_fonts", "Inter Bold")
        style = media_config.get("image_style", "typographic")

        style_instructions = {
            "typographic": f"Bold typographic poster. Large impactful text as hero. {primary} accent color. No illustrations, no people. Text-first design.",
            "photorealistic": f"Cinematic photography style. {primary} color grading. Professional editorial quality.",
            "illustration": f"Modern vector illustration. {primary} and {secondary} color palette. Clean flat design.",
            "minimal": f"Ultra minimal. Single bold statement. {primary} accent. Maximum white/negative space.",
            "data_visual": f"Data visualization. {primary} charts and stats. Bold numbers. Infographic style.",
        }

        return f"""{content_prompt}

Visual style: {style_instructions.get(style, style_instructions["typographic"])}

Brand specifications:
- Background: {bg} (exact hex)
- Primary accent: {primary} (exact hex, use for headlines and key elements)
- Secondary accent: {secondary} (use sparingly for highlights)
- Mood: {mood}
- Typography: {fonts} style
- Format: square 1:1 social media post, 1080x1080px equivalent

Quality requirements:
- High contrast between text and background
- Text must be perfectly legible
- Professional graphic design quality
- No watermarks, no borders, no stock photo look
- The background MUST be very dark (close to {bg})
- Primary color {primary} MUST be prominently visible""".strip()

    async def generate_image(
        self,
        prompt: str,
        media_config: dict = {},
        # Legacy params kept for backward compatibility — prefer media_config
        style: str = "typographic",
        aspect_ratio: str = "1:1",
        color_palette: str = "dark",
    ) -> str:
        """Call Ideogram /generate, upload the result to S3, and return the public URL."""
        from app.services.storage.s3 import S3Service

        # If media_config is provided with brand colors, use the rich build_prompt
        if media_config and ("image_primary_color" in media_config or "image_style" in media_config):
            full_prompt = self.build_prompt(prompt, media_config)
            effective_style = media_config.get("image_style", "typographic")
            effective_ratio = media_config.get("image_aspect_ratio", "1:1")
        else:
            # Legacy path: use individual params
            color_hint = self.COLOR_PROMPTS.get(color_palette, self.COLOR_PROMPTS["dark"])
            full_prompt = f"{prompt}. Style: {color_hint}. Clean, bold, professional."
            effective_style = style
            effective_ratio = aspect_ratio

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.BASE_URL}/generate",
                    headers={"Api-Key": self.api_key, "Content-Type": "application/json"},
                    json={
                        "image_request": {
                            "prompt": full_prompt,
                            "aspect_ratio": self.RATIO_MAP.get(effective_ratio, "ASPECT_1_1"),
                            "model": "V_2_TURBO",
                            "style_type": self.STYLE_MAP.get(effective_style, "DESIGN"),
                            "negative_prompt": "blurry, low quality, distorted text, pixelated",
                        }
                    },
                    timeout=60.0,
                )
                if response.status_code != 200:
                    logger.error(
                        f"Ideogram API error {response.status_code}: {response.text}"
                    )
                    raise HTTPException(status_code=502, detail=f"Ideogram API error: {response.text}")

                image_url = response.json()["data"][0]["url"]
        except HTTPException:
            raise
        except Exception as exc:
            logger.error(f"Ideogram generate_image unexpected error: {exc}", exc_info=True)
            raise

        s3_service = S3Service()
        return await s3_service.upload_from_url(image_url, folder="generated/images")
