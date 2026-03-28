"""Content management endpoints."""
import re
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.models.content import ContentPost
from app.models.project import Project
from app.services.claude.client import ClaudeClient
from app.services.n8n.client import N8nClient
from app.services.storage.s3 import S3Service

router = APIRouter()

claude_client = ClaudeClient()
s3_service = S3Service()
n8n_client = N8nClient()


class ContentPostResponse(BaseModel):
    id: int
    project_id: int
    format: str
    status: str
    caption: str | None
    published_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ManualContentRequest(BaseModel):
    topic: str
    tone: Optional[str] = None
    content_type: str = "carousel_6_slides"  # carousel_6_slides | single_image | text_post
    image_url: Optional[str] = None
    caption: Optional[str] = None  # if empty, Claude generates it
    hashtags: list[str] = []
    scheduled_at: Optional[str] = None  # ISO datetime string


class UpdateContentRequest(BaseModel):
    caption: Optional[str] = None
    image_url: Optional[str] = None
    hashtags: Optional[list[str]] = None
    slides: Optional[list[dict]] = None  # updated slide data
    scheduled_at: Optional[str] = None
    status: Optional[str] = None


class BatchContentRequest(BaseModel):
    period_start: str  # ISO date
    period_end: str    # ISO date
    count: int         # how many posts to generate
    days_of_week: list[int] = [1, 3, 5]  # 0=Mon, 6=Sun
    publish_time: str = "09:00"  # HH:MM
    content_type: str = "carousel_6_slides"


@router.get("/list/{project_slug}")
async def list_content_by_slug(
    project_slug: str,
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """List content posts for a project by slug with pagination and optional date filtering."""
    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    query = select(ContentPost).where(ContentPost.project_id == project.id)
    count_query = select(func.count(ContentPost.id)).where(ContentPost.project_id == project.id)

    if status:
        query = query.where(ContentPost.status == status)
        count_query = count_query.where(ContentPost.status == status)

    if date_from:
        dt_from = datetime.fromisoformat(date_from)
        query = query.where(
            (ContentPost.scheduled_at >= dt_from) |
            ((ContentPost.scheduled_at == None) & (ContentPost.created_at >= dt_from))  # noqa: E711
        )
        count_query = count_query.where(
            (ContentPost.scheduled_at >= dt_from) |
            ((ContentPost.scheduled_at == None) & (ContentPost.created_at >= dt_from))  # noqa: E711
        )

    if date_to:
        dt_to = datetime.fromisoformat(date_to)
        query = query.where(
            (ContentPost.scheduled_at <= dt_to) |
            ((ContentPost.scheduled_at == None) & (ContentPost.created_at <= dt_to))  # noqa: E711
        )
        count_query = count_query.where(
            (ContentPost.scheduled_at <= dt_to) |
            ((ContentPost.scheduled_at == None) & (ContentPost.created_at <= dt_to))  # noqa: E711
        )

    total_result = await db.execute(count_query)
    total = total_result.scalar_one() or 0

    offset = (page - 1) * per_page
    posts_result = await db.execute(
        query.order_by(ContentPost.created_at.desc()).offset(offset).limit(per_page)
    )
    posts = posts_result.scalars().all()

    return {
        "items": [
            {
                "id": p.id,
                "project_id": p.project_id,
                "format": p.format,
                "status": p.status,
                "caption": p.caption,
                "image_url": p.image_url,
                "scheduled_at": str(p.scheduled_at) if p.scheduled_at else None,
                "batch_id": p.batch_id,
                "published_at": str(p.published_at) if p.published_at else None,
                "created_at": str(p.created_at),
            }
            for p in posts
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{project_id}", response_model=list[ContentPostResponse])
async def list_content(project_id: int, db: AsyncSession = Depends(get_session)) -> list[ContentPost]:
    """List content posts for a project."""
    result = await db.execute(
        select(ContentPost)
        .where(ContentPost.project_id == project_id)
        .order_by(ContentPost.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.post("/generate/{project_slug}")
async def generate_content(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate carousel content for a project using Claude, upload placeholder to S3, trigger n8n."""
    # 1. Load project
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # 2. Check active
    if not project.is_active:
        raise HTTPException(status_code=400, detail="Project is inactive")

    # 3. Build webhook URL
    webhook_url = f"{project.n8n_webhook_base_url}/publish-meta"

    # 4. Generate content with Claude
    try:
        content = await claude_client.generate_carousel_content(project)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Claude generation failed: {str(e)}")

    # 5. Extract caption
    caption = content.get("caption", "")

    # 6. Render and upload carousel slide images
    try:
        image_urls = await s3_service.upload_carousel_slides(project_slug, content)
        image_url = image_urls[0] if image_urls else ""
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"S3 upload failed: {str(e)}")

    # 7. Trigger n8n webhook
    try:
        await n8n_client.trigger_publish(webhook_url, caption, image_urls, project_slug)
        webhook_triggered = True
    except HTTPException:
        webhook_triggered = False

    # 8. Save to DB
    post = ContentPost(
        project_id=project.id,
        format="carousel",
        status="pending_approval",
        content=content,
        image_url=image_url,
        caption=caption,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    try:
        from app.services.notifications import NotificationService
        notif_svc = NotificationService(db)
        topic = content.get("topic", "Contenido generado") if isinstance(content, dict) else "Contenido generado"
        await notif_svc.create(
            type="content_pending",
            title=f"Nuevo contenido pendiente — {project.name}",
            message=topic,
            project_id=project.id,
            action_url=f"/dashboard/content?id={post.id}",
            action_label="Revisar",
        )
    except Exception:
        pass  # Never break content generation due to notification failure

    return {
        "id": post.id,
        "project_slug": project_slug,
        "status": post.status,
        "content": content,
        "image_url": image_url,
        "image_urls": image_urls,
        "webhook_triggered": webhook_triggered,
        "message": "Content generated and sent for approval",
    }


@router.post("/create/{project_slug}")
async def create_content_manual(
    project_slug: str,
    body: ManualContentRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Create content manually with optional AI caption generation."""
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    caption = body.caption
    if not caption:
        # Generate just the caption with Claude
        config = project.content_config or {}
        language = config.get("language", "en")
        tone = body.tone or config.get("tone", "professional")
        try:
            caption = await claude_client.generate_caption(body.topic, tone, language)
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Claude failed: {str(e)}")

    hashtags_str = " ".join(f"#{tag.lstrip('#')}" for tag in body.hashtags) if body.hashtags else ""
    full_caption = f"{caption}\n\n{hashtags_str}".strip() if hashtags_str else caption

    scheduled = None
    if body.scheduled_at:
        try:
            scheduled = datetime.fromisoformat(body.scheduled_at)
        except ValueError:
            pass

    post = ContentPost(
        project_id=project.id,
        format=body.content_type,
        status="pending_approval",
        content={"topic": body.topic, "content_type": body.content_type, "hashtags": body.hashtags},
        image_url=body.image_url,
        caption=full_caption,
        scheduled_at=scheduled,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    try:
        from app.services.notifications import NotificationService
        notif_svc = NotificationService(db)
        post_content = post.content or {}
        topic = post_content.get("topic", body.topic) if isinstance(post_content, dict) else body.topic
        await notif_svc.create(
            type="content_pending",
            title=f"Nuevo contenido pendiente — {project.name}",
            message=topic,
            project_id=project.id,
            action_url=f"/dashboard/content?id={post.id}",
            action_label="Revisar",
        )
    except Exception:
        pass  # Never break content generation due to notification failure

    # Trigger n8n if project has webhook
    webhook_url = f"{project.n8n_webhook_base_url}/publish-meta" if project.n8n_webhook_base_url else None
    webhook_triggered = False
    if webhook_url:
        try:
            await n8n_client.trigger_publish(webhook_url, full_caption, [body.image_url] if body.image_url else [], project_slug)
            webhook_triggered = True
        except Exception:
            pass

    return {
        "id": post.id,
        "project_slug": project_slug,
        "status": post.status,
        "caption": post.caption,
        "image_url": post.image_url,
        "scheduled_at": str(post.scheduled_at) if post.scheduled_at else None,
        "webhook_triggered": webhook_triggered,
    }


@router.put("/{content_id}")
async def update_content(
    content_id: int,
    body: UpdateContentRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Update a content post."""
    result = await db.execute(select(ContentPost).where(ContentPost.id == content_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {content_id} not found")

    if body.caption is not None:
        post.caption = body.caption
    if body.image_url is not None:
        post.image_url = body.image_url
    if body.status is not None:
        post.status = body.status
    if body.scheduled_at is not None:
        try:
            post.scheduled_at = datetime.fromisoformat(body.scheduled_at)
        except ValueError:
            pass
    if body.slides is not None and post.content:
        content_data = dict(post.content) if post.content else {}
        content_data["slides"] = body.slides
        post.content = content_data

    await db.commit()
    await db.refresh(post)

    return {
        "id": post.id,
        "status": post.status,
        "caption": post.caption,
        "image_url": post.image_url,
        "scheduled_at": str(post.scheduled_at) if post.scheduled_at else None,
        "content": post.content,
    }


@router.post("/batch/{project_slug}")
async def batch_generate_content(
    project_slug: str,
    body: BatchContentRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate multiple content posts for a batch plan."""
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # Parse dates
    period_start = datetime.fromisoformat(body.period_start)
    period_end = datetime.fromisoformat(body.period_end)

    # Parse publish_time
    time_match = re.match(r"(\d{1,2}):(\d{2})", body.publish_time)
    pub_hour = int(time_match.group(1)) if time_match else 9
    pub_minute = int(time_match.group(2)) if time_match else 0

    # Get available publish dates in period
    available_dates = []
    current = period_start
    while current <= period_end:
        if current.weekday() in body.days_of_week:
            available_dates.append(current.replace(hour=pub_hour, minute=pub_minute, second=0))
        current += timedelta(days=1)

    if not available_dates:
        raise HTTPException(status_code=400, detail="No valid publish dates in selected period")

    # Distribute count across available dates
    count = min(body.count, len(available_dates))
    step = len(available_dates) / count
    scheduled_dates = [available_dates[int(i * step)] for i in range(count)]

    batch_id = str(uuid.uuid4())[:8]
    generated_posts = []

    for sched_dt in scheduled_dates:
        try:
            content = await claude_client.generate_carousel_content(project)
        except Exception:
            content = {"topic": "auto-generated", "slides": [], "caption": "", "hashtags": []}

        caption = content.get("caption", "")
        hashtags = content.get("hashtags", [])
        hashtag_str = " ".join(f"#{t}" for t in hashtags) if hashtags else ""
        full_caption = f"{caption}\n\n{hashtag_str}".strip() if hashtag_str else caption

        post = ContentPost(
            project_id=project.id,
            format="carousel",
            status="draft",
            content=content,
            caption=full_caption,
            scheduled_at=sched_dt,
            batch_id=batch_id,
        )
        db.add(post)
        await db.flush()
        generated_posts.append({
            "id": post.id,
            "caption": post.caption,
            "scheduled_at": sched_dt.isoformat(),
            "status": "draft",
            "slides": content.get("slides", []),
            "topic": content.get("topic", ""),
        })

    await db.commit()

    return {
        "batch_id": batch_id,
        "count": len(generated_posts),
        "posts": generated_posts,
    }
