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
    }

    COLOR_PROMPTS = {
        "dark_purple": "dark background #0f0a19, neon purple accent #7c3aed, white typography",
        "dark_green": "dark background #0a140f, neon green accent #22c55e, white typography",
        "dark_blue": "dark background #0a0f19, electric blue accent #3b82f6, white typography",
        "dark_orange": "dark background #140c05, orange accent #f97316, white typography",
        "dark": "dark background #0a0a0a, white typography, minimal design",
    }

    def __init__(self) -> None:
        self.api_key = settings.IDEOGRAM_API_KEY

    async def generate_image(
        self,
        prompt: str,
        style: str = "typographic",
        aspect_ratio: str = "1:1",
        color_palette: str = "dark",
    ) -> str:
        """Call Ideogram /generate, upload the result to S3, and return the public URL."""
        from app.services.storage.s3 import S3Service

        color_hint = self.COLOR_PROMPTS.get(color_palette, self.COLOR_PROMPTS["dark"])
        full_prompt = f"{prompt}. Style: {color_hint}. Clean, bold, professional."

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.BASE_URL}/generate",
                headers={"Api-Key": self.api_key, "Content-Type": "application/json"},
                json={
                    "image_request": {
                        "prompt": full_prompt,
                        "aspect_ratio": self.RATIO_MAP.get(aspect_ratio, "ASPECT_1_1"),
                        "model": "V_2",
                        "style_type": self.STYLE_MAP.get(style, "DESIGN"),
                        "negative_prompt": "blurry, low quality, distorted text, pixelated",
                    }
                },
                timeout=60.0,
            )
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Ideogram API error: {response.text}")

            image_url = response.json()["data"][0]["url"]

        s3_service = S3Service()
        return await s3_service.upload_from_url(image_url, folder="generated/images")
