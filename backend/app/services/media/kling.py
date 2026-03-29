"""Kling AI video generation provider."""
import asyncio
import logging

import httpx
from fastapi import HTTPException

from app.core.config import settings
from app.services.media.base import BaseVideoProvider

logger = logging.getLogger(__name__)


class KlingProvider(BaseVideoProvider):
    """Generates videos via the Kling AI API and stores them in S3.

    Kling is async: submit a task, then poll every 10 s up to 30 attempts (5-min timeout).
    """

    BASE_URL = "https://api.klingai.com/v1"

    def __init__(self) -> None:
        self.api_key = settings.KLING_API_KEY

    async def generate_video(
        self,
        prompt: str,
        image_url: str = None,
        duration: int = 5,
        aspect_ratio: str = "9:16",
    ) -> str:
        """Submit a Kling generation task, poll until complete, upload to S3, return URL."""
        from app.services.storage.s3 import S3Service

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        if image_url:
            payload = {
                "model": "kling-v1",
                "image": image_url,
                "prompt": prompt,
                "duration": str(duration),
                "aspect_ratio": aspect_ratio,
                "mode": "std",
            }
            endpoint = f"{self.BASE_URL}/images/kolors-virtual-try-on"
        else:
            payload = {
                "model": "kling-v1",
                "prompt": prompt,
                "duration": str(duration),
                "aspect_ratio": aspect_ratio,
                "mode": "std",
                "negative_prompt": "blurry, low quality, watermark",
            }
            endpoint = f"{self.BASE_URL}/videos/text2video"

        async with httpx.AsyncClient() as client:
            response = await client.post(endpoint, headers=headers, json=payload, timeout=30.0)
            if response.status_code not in (200, 201):
                raise HTTPException(status_code=502, detail=f"Kling API error: {response.text}")

            task_id = response.json()["data"]["task_id"]
            logger.info("Kling task submitted: %s", task_id)

            for attempt in range(30):
                await asyncio.sleep(10)
                status_response = await client.get(
                    f"{self.BASE_URL}/videos/text2video/{task_id}",
                    headers=headers,
                    timeout=30.0,
                )
                status_data = status_response.json()["data"]
                task_status = status_data.get("task_status")
                logger.info("Kling task %s — attempt %d — status: %s", task_id, attempt + 1, task_status)

                if task_status == "succeed":
                    video_url = status_data["task_result"]["videos"][0]["url"]
                    s3_service = S3Service()
                    return await s3_service.upload_from_url(video_url, folder="generated/videos")

                if task_status == "failed":
                    raise HTTPException(
                        status_code=502,
                        detail=f"Kling generation failed: {status_data}",
                    )

        raise HTTPException(
            status_code=504,
            detail="Kling video generation timed out after 5 minutes",
        )
