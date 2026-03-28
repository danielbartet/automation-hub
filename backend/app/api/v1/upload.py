"""File upload endpoint — stores files to S3."""
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.api.deps import get_session
from app.models.project import Project
from app.core.config import settings
import boto3
from datetime import datetime

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "video/mp4"}
MAX_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/{project_slug}")
async def upload_file(
    project_slug: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
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

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = "videos" if file.content_type == "video/mp4" else "images"
    key = f"{folder}/{project_slug}/{timestamp}_{file.filename}"

    try:
        session = boto3.Session(profile_name=settings.AWS_PROFILE)
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
