"""Image-to-video conversion utility using ffmpeg.

Converts a static PNG (from S3 URL or local path) to a 5-second H.264 MP4
suitable for Instagram Story publishing via the VIDEO container type.
"""
import asyncio
import logging
import os
import tempfile
from datetime import datetime

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ffmpeg command template — produces a 5-second 1080x1920 H.264 video with no
# audio.  The scale+pad filter letterboxes/pillarboxes the source image to fit
# exactly into 1080x1920 without stretching.
_FFMPEG_ARGS = [
    "ffmpeg",
    "-y",                          # overwrite output without asking
    "-loop", "1",                  # loop the single input frame
    "-i", "{input}",               # placeholder — replaced at runtime
    "-c:v", "libx264",
    "-t", "5",                     # duration in seconds
    "-pix_fmt", "yuv420p",         # required for broad playback compatibility
    "-vf", (
        "scale=1080:1920:force_original_aspect_ratio=decrease,"
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2"
    ),
    "-r", "30",                    # 30 fps
    "{output}",                    # placeholder — replaced at runtime
]


async def convert_image_to_story_video(image_url: str, s3_service: "S3Service") -> str:  # noqa: F821
    """Download *image_url* from S3, convert it to a 5-second MP4, upload it
    back to S3 under ``generated/stories/`` and return the public MP4 URL.

    Parameters
    ----------
    image_url:
        Public HTTPS URL of the source PNG (e.g. from S3).
    s3_service:
        An initialised :class:`~app.services.storage.s3.S3Service` instance
        used for the final MP4 upload.

    Returns
    -------
    str
        Public S3 URL of the generated ``.mp4`` file.
    """
    logger.info("story-video: starting conversion for %s", image_url)

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, "story_input.png")
        output_path = os.path.join(tmpdir, "story_output.mp4")

        # --- 1. Download source image ---
        logger.info("story-video: downloading source image")
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(image_url)
            resp.raise_for_status()
        with open(input_path, "wb") as fh:
            fh.write(resp.content)
        logger.info("story-video: downloaded %d bytes to %s", len(resp.content), input_path)

        # --- 2. Run ffmpeg ---
        cmd = [
            arg.replace("{input}", input_path).replace("{output}", output_path)
            for arg in _FFMPEG_ARGS
        ]
        logger.info("story-video: running ffmpeg: %s", " ".join(cmd))

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            logger.error(
                "story-video: ffmpeg failed (rc=%d)\nstderr: %s",
                proc.returncode,
                stderr.decode(errors="replace"),
            )
            raise RuntimeError(
                f"ffmpeg exited with code {proc.returncode}: "
                f"{stderr.decode(errors='replace')[:500]}"
            )

        logger.info("story-video: ffmpeg completed successfully")

        # --- 3. Upload MP4 to S3 ---
        with open(output_path, "rb") as fh:
            mp4_bytes = fh.read()

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        key = f"generated/stories/{timestamp}.mp4"

        s3_service.s3.put_object(
            Bucket=s3_service.bucket,
            Key=key,
            Body=mp4_bytes,
            ContentType="video/mp4",
        )
        video_url = f"https://{s3_service.bucket}.s3.amazonaws.com/{key}"
        logger.info("story-video: uploaded MP4 to S3 — %s (%d bytes)", video_url, len(mp4_bytes))

    return video_url
