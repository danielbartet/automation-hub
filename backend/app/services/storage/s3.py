"""S3 storage service — image upload and management."""
import io
from datetime import datetime
import boto3
from PIL import Image, ImageDraw
from app.core.config import settings
from app.services.storage.renderer import CarouselRenderer


class S3Service:
    """Client for uploading files to S3."""

    def __init__(self) -> None:
        profile = settings.AWS_PROFILE if settings.AWS_PROFILE else None
        self.session = boto3.Session(profile_name=profile)
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
