---
name: file-upload
description: "ALWAYS use this skill when handling file uploads from the dashboard. Load it whenever: accepting image or video uploads from the Next.js frontend, processing uploaded files, storing files in S3, generating presigned URLs, or handling multipart form data in FastAPI. No extra libraries needed beyond python-multipart and boto3."
---

# File Upload Skill

## Stack
- Backend: FastAPI + python-multipart + boto3
- Frontend: FormData API + fetch + react-dropzone
- Storage: S3 bucket quantoria-static (us-east-1)
- AWS Profile: chatbot-daniel (local), IAM role (production)

## FastAPI endpoint
```python
from fastapi import APIRouter, UploadFile, File, HTTPException
import boto3
from datetime import datetime

router = APIRouter()

@router.post("/api/v1/upload/{project_slug}")
async def upload_file(
    project_slug: str,
    file: UploadFile = File(...),
):
    allowed_types = ["image/jpeg", "image/png", "image/webp", "video/mp4"]
    if file.content_type not in allowed_types:
        raise HTTPException(400, f"Type {file.content_type} not allowed")

    contents = await file.read()
    if len(contents) > 50 * 1024 * 1024:
        raise HTTPException(400, "Max 50MB")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = "videos" if file.content_type == "video/mp4" else "images"
    key = f"{folder}/{project_slug}/{timestamp}_{file.filename}"

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
```

## Next.js upload function
```typescript
const uploadFile = async (file: File, projectSlug: string): Promise<string> => {
  const formData = new FormData()
  formData.append("file", file)
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/upload/${projectSlug}`,
    { method: "POST", body: formData }
  )
  if (!res.ok) throw new Error("Upload failed")
  const data = await res.json()
  return data.url
}
```

## Drag & drop component (dashboard)
Library: react-dropzone (pnpm add react-dropzone)
Accepts: image/jpeg, image/png, image/webp, video/mp4
Max size: 50MB
Show preview before upload
Return S3 URL after upload completes

## S3 paths
Images: images/{project_slug}/{timestamp}_{filename}
Videos: videos/{project_slug}/{timestamp}_{filename}
Public URL: https://quantoria-static.s3.amazonaws.com/{key}

## Presigned URL (future — private files)
```python
presigned = s3.generate_presigned_url(
    "get_object",
    Params={"Bucket": settings.AWS_BUCKET, "Key": key},
    ExpiresIn=3600
)
```
