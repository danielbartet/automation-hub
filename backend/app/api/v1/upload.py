"""File upload endpoint — stores files to S3."""
import re
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.api.deps import get_session, get_current_user
from app.models.project import Project
from app.core.config import settings
from app.services.storage.s3 import _make_boto3_session
from datetime import datetime

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "video/mp4"}
MAX_SIZE = 50 * 1024 * 1024  # 50 MB

# Magic bytes for image type detection (don't trust Content-Type header)
_MAGIC_BYTES: list[tuple[bytes, str]] = [
    (b'\xff\xd8\xff', 'image/jpeg'),
    (b'\x89PNG\r\n', 'image/png'),
    (b'GIF87a', 'image/gif'),
    (b'GIF89a', 'image/gif'),
    (b'RIFF', 'image/webp'),  # refined below for WebP
]


def _detect_mime(data: bytes) -> str | None:
    """Detect MIME type from file magic bytes. Returns None if unrecognized."""
    # Special-case WebP: RIFF????WEBP
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    for magic, mime in _MAGIC_BYTES:
        if mime == 'image/webp':
            continue  # already handled above
        if data[:len(magic)] == magic:
            return mime
    return None


@router.post("/{project_slug}")
async def upload_file(
    project_slug: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Upload an image or video file to S3 for a given project."""
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Type {file.content_type} not allowed")

    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="Max 50MB")

    # Magic bytes validation for image uploads (skip for video/mp4)
    if file.content_type != "video/mp4":
        detected = _detect_mime(contents)
        if detected not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=400,
                detail="File content does not match an allowed image type",
            )

    # Sanitize filename to prevent path traversal and injection
    raw_filename = file.filename or "upload"
    safe_filename = re.sub(r'[^a-zA-Z0-9._-]', '_', raw_filename)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = "videos" if file.content_type == "video/mp4" else "images"
    key = f"{folder}/{project_slug}/{timestamp}_{safe_filename}"

    try:
        session = _make_boto3_session()
        s3 = session.client("s3", region_name=settings.AWS_REGION)
        s3.put_object(
            Bucket=settings.AWS_BUCKET,
            Key=key,
            Body=contents,
            ContentType=file.content_type,
        )
        url = f"https://{settings.AWS_BUCKET}.s3.amazonaws.com/{key}"
        return {"url": url, "key": key, "content_type": file.content_type}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")
