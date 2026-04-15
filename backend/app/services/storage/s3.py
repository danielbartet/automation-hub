"""S3 storage service — image upload and management."""
import io
import os
import socket
import ipaddress
import logging
from datetime import datetime
from urllib.parse import urlparse
import boto3
import httpx
from botocore.exceptions import ProfileNotFound, NoCredentialsError
from PIL import Image, ImageDraw
from app.core.config import settings
from app.services.storage.renderer import CarouselRenderer

logger = logging.getLogger(__name__)


def _is_safe_url(url: str) -> bool:
    """Return True only if the URL is safe to fetch (not an internal/private address)."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("https", "http"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        # Block localhost variants
        if hostname in ("localhost", "127.0.0.1", "::1"):
            return False
        # Resolve and check for private/link-local/loopback/reserved ranges
        ip = ipaddress.ip_address(socket.gethostbyname(hostname))
        if ip.is_private or ip.is_link_local or ip.is_loopback or ip.is_reserved:
            return False
        return True
    except Exception:
        return False


def _make_boto3_session() -> boto3.Session:
    """Return a boto3 Session using the best available credential source.

    Priority:
    1. If AWS_ACCESS_KEY_ID env var is set, use the default credential chain
       (env vars → IAM role → instance profile) — no named profile.
    2. If AWS_PROFILE setting is configured, try the named profile.
    3. Fall back to the default credential chain (IAM role / instance profile).
    """
    if os.environ.get("AWS_ACCESS_KEY_ID"):
        # Explicit credentials in env — let boto3 pick them up automatically.
        return boto3.Session()

    if settings.AWS_PROFILE:
        try:
            session = boto3.Session(profile_name=settings.AWS_PROFILE)
            # Validate that the profile actually has credentials.
            session.get_credentials().get_frozen_credentials()
            return session
        except (ProfileNotFound, NoCredentialsError, AttributeError):
            logger.warning(
                "AWS profile '%s' not found or has no credentials — "
                "falling back to default credential chain.",
                settings.AWS_PROFILE,
            )

    # Default chain: IAM role, instance profile, etc.
    return boto3.Session()


class S3Service:
    """Client for uploading files to S3."""

    def __init__(self) -> None:
        self.session = _make_boto3_session()
        self.s3 = self.session.client("s3", region_name=settings.AWS_REGION)
        self.bucket = settings.AWS_BUCKET

    async def upload_carousel_slides(self, project_slug: str, content: dict) -> list[str]:
        """Render carousel slides and upload all to S3. Returns list of public URLs."""
        renderer = CarouselRenderer()
        slide_images = renderer.render_all(content)

        urls = []
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        for i, img_bytes in enumerate(slide_images):
            key = f"images/{project_slug}/{timestamp}_slide_{i + 1}.png"
            self.s3.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=img_bytes,
                ContentType="image/png",
            )
            urls.append(f"https://{self.bucket}.s3.amazonaws.com/{key}")
        return urls

    async def upload_from_url(self, url: str, folder: str = "images") -> str:
        """Download a file from a URL and upload it to S3. Returns the public URL."""
        if not _is_safe_url(url):
            raise ValueError(f"URL is not allowed: {url}")
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=60.0)
            response.raise_for_status()

        content_type = response.headers.get("content-type", "image/png")
        ext = "mp4" if "video" in content_type else "png"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        key = f"{folder}/{timestamp}.{ext}"

        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=response.content,
            ContentType=content_type,
        )
        return f"https://{self.bucket}.s3.amazonaws.com/{key}"

    async def upload_bytes(self, data: bytes, folder: str = "generated") -> str:
        """Upload raw bytes to S3 and return the public URL."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        key = f"{folder}/{timestamp}.png"
        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType="image/png",
        )
        return f"https://{self.bucket}.s3.amazonaws.com/{key}"

    async def upload_placeholder_image(self, project_slug: str) -> str:
        """Generate and upload a placeholder carousel image, return public URL. Fallback only."""
        img = Image.new("RGB", (1080, 1080), color=(15, 15, 15))
        draw = ImageDraw.Draw(img)
        draw.text((540, 540), project_slug.upper(), fill=(255, 255, 255), anchor="mm")

        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        key = f"images/{project_slug}/{timestamp}.png"

        self.s3.upload_fileobj(buffer, self.bucket, key)
        return f"https://{self.bucket}.s3.amazonaws.com/{key}"
