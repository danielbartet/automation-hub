"""Content management endpoints."""
import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.config import settings
from app.core.security import decrypt_token
from app.models.content import ContentPost
from app.models.project import Project
from app.services.claude.client import ClaudeClient
from app.services.media.factory import get_image_provider, get_video_provider
from app.services.meta.client import MetaClient
from app.services.meta.pages import PagesService
from app.services.meta.instagram import InstagramService
from app.services.n8n.client import N8nClient
from app.services.storage.s3 import S3Service

router = APIRouter()

claude_client = ClaudeClient()
_s3_service: S3Service | None = None

def get_s3_service() -> S3Service:
    global _s3_service
    if _s3_service is None:
        _s3_service = S3Service()
    return _s3_service
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
    image_urls: Optional[list[str]] = None  # per-slide image URLs for carousel formats
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


class AutoGenerateRequest(BaseModel):
    content_type: str = "carousel_6_slides"  # carousel_6_slides | single_image | text_post
    category: Optional[str] = None           # must be one of project.content_config.content_categories
    hint: Optional[str] = None               # short free-text topic hint
    image_mode: str = "ideogram"             # ideogram | placeholder


class GenerateImageRequest(BaseModel):
    prompt: str = ""
    style: str = "typographic"
    aspect_ratio: str = "1:1"
    color_palette: str = "dark"


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
                "image_urls": p.image_urls,
                "content": p.content,
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
    body: AutoGenerateRequest = AutoGenerateRequest(),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate content for a project using Claude.

    Supports content_type: carousel_6_slides | single_image | text_post
    Optional category and hint guide Claude's output.
    image_mode (ideogram | placeholder) controls cover-image generation for image-based types.
    """
    # 1. Load project
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # 2. Check active
    if not project.is_active:
        raise HTTPException(status_code=400, detail="Project is inactive")

    # 3. Validate category against project config (if provided)
    if body.category:
        allowed_cats = (project.content_config or {}).get("content_categories", [])
        if allowed_cats and body.category not in allowed_cats:
            raise HTTPException(
                status_code=422,
                detail=f"Category '{body.category}' not in project content_categories",
            )

    # 4. Build webhook URL
    webhook_url = f"{project.n8n_webhook_base_url}/publish-meta"

    # 5. Generate content with Claude
    try:
        content = await claude_client.generate_content_by_type(
            project,
            content_type=body.content_type,
            category=body.category,
            hint=body.hint,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Claude generation failed: {str(e)}")

    # 6. Caption extraction
    caption = content.get("caption", "")

    # 7. Image handling — branch by content_type
    media_config = project.media_config or {}
    image_url: str = ""
    image_urls: list[str] = []

    if body.content_type == "carousel_6_slides":
        # Determine image provider — override from request if provided
        carousel_image_provider = media_config.get("image_provider", "html")
        if body.image_mode and body.image_mode not in ("ideogram", "placeholder"):
            # image_mode "html" or unrecognised → use html
            carousel_image_provider = "html"
        elif body.image_mode in ("ideogram", "placeholder"):
            carousel_image_provider = body.image_mode

        if carousel_image_provider in ("html", None, "") or carousel_image_provider not in ("ideogram", "placeholder"):
            # HTML renderer — render one slide per carousel entry
            from app.services.media.html_renderer import HTMLSlideRenderer
            renderer = HTMLSlideRenderer()
            slides_data = content.get("slides", [])
            generated_urls: list[str] = []
            effective_media_config = dict(media_config)
            if not effective_media_config.get("brand_handle"):
                effective_media_config["brand_handle"] = project.slug.replace("-", "")
            for i, slide in enumerate(slides_data):
                slide_data = {
                    "headline": slide.get("headline", ""),
                    "subtext": slide.get("body", slide.get("subtext", "")),
                    "slide_number": i + 1,
                    "total_slides": len(slides_data),
                }
                try:
                    url = await renderer.render_slide(slide_data, effective_media_config)
                    generated_urls.append(url)
                    project.credits_balance = max(0, (project.credits_balance or 0) - 5)
                    project.credits_used_this_month = (project.credits_used_this_month or 0) + 5
                except Exception as e:
                    logger.warning(f"HTML render failed slide {i + 1}, using placeholder: {e}")
                    try:
                        placeholder_url = await get_s3_service().upload_placeholder_image(project_slug)
                    except Exception:
                        placeholder_url = ""
                    generated_urls.append(placeholder_url)
            image_urls = generated_urls
            image_url = image_urls[0] if image_urls else ""
            if generated_urls:
                await db.commit()
        else:
            # Non-HTML carousel path: first upload basic Pillow-rendered slides, then optionally replace
            try:
                image_urls = await get_s3_service().upload_carousel_slides(project_slug, content)
                image_url = image_urls[0] if image_urls else ""
            except Exception as e:
                raise HTTPException(status_code=503, detail=f"S3 upload failed: {str(e)}")

            if carousel_image_provider != "placeholder":
                slides_data = content.get("slides", [])
                credits_per_image = 10
                if (project.credits_balance or 0) >= credits_per_image and slides_data:
                    provider = get_image_provider(carousel_image_provider)
                    generated_urls = []
                    for i, slide in enumerate(slides_data):
                        slide_headline = slide.get("headline", "")
                        slide_subtext = slide.get("subtext", "")
                        slide_prompt = f"{slide_headline}. {slide_subtext}. Brand: {project.name}.".strip()
                        fallback_url = image_urls[i] if i < len(image_urls) else ""
                        try:
                            if (project.credits_balance or 0) >= credits_per_image:
                                generated_url = await provider.generate_image(
                                    prompt=slide_prompt,
                                    media_config=media_config,
                                )
                                generated_urls.append(generated_url)
                                project.credits_balance = (project.credits_balance or 0) - credits_per_image
                                project.credits_used_this_month = (project.credits_used_this_month or 0) + credits_per_image
                            else:
                                generated_urls.append(fallback_url)
                        except Exception as e:
                            logger.warning(f"Image provider failed for slide {i}, falling back to placeholder: {e}")
                            generated_urls.append(fallback_url)
                    if generated_urls:
                        image_urls = generated_urls
                        image_url = image_urls[0]
                        await db.commit()

    elif body.content_type == "single_image":
        # image_mode == "placeholder" forces placeholder; otherwise use project provider (default: ideogram)
        if body.image_mode == "placeholder":
            effective_provider = "placeholder"
        else:
            effective_provider = media_config.get("image_provider", "ideogram")

        try:
            headline = content.get("headline", "")
            subtext = content.get("subtext", "")
            image_prompt = f"{headline}. {subtext}. Brand: {project.name}.".strip()

            if effective_provider != "placeholder" and (project.credits_balance or 0) >= 10:
                provider = get_image_provider(effective_provider)
                image_url = await provider.generate_image(
                    prompt=image_prompt,
                    media_config=media_config,
                )
                image_urls = [image_url]
                project.credits_balance = (project.credits_balance or 0) - 10
                project.credits_used_this_month = (project.credits_used_this_month or 0) + 10
                await db.commit()
            else:
                # Placeholder path: upload a placeholder image via S3
                try:
                    placeholder_provider = get_image_provider("placeholder")
                    image_url = await placeholder_provider.generate_image(prompt=image_prompt)
                    image_urls = [image_url]
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Image provider failed for single_image, falling back to placeholder: {e}")

    # text_post: no image needed

    # 8. Trigger n8n webhook
    try:
        await n8n_client.trigger_publish(webhook_url, caption, image_urls, project_slug)
        webhook_triggered = True
    except HTTPException:
        webhook_triggered = False

    # 9. Determine DB format field
    if body.content_type == "carousel_6_slides":
        db_format = "carousel"
    elif body.content_type == "single_image":
        db_format = "single_image"
    else:
        db_format = "text_post"

    # 10. Save to DB
    post = ContentPost(
        project_id=project.id,
        format=db_format,
        status="pending_approval",
        content=content,
        image_url=image_url or None,
        image_urls=json.dumps(image_urls) if image_urls else None,
        caption=caption,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    try:
        from app.services.notifications import NotificationService
        from app.core.database import AsyncSessionLocal
        topic = content.get("topic", "Contenido generado") if isinstance(content, dict) else "Contenido generado"
        async with AsyncSessionLocal() as notif_db:
            notif_svc = NotificationService(notif_db)
            await notif_svc.create(
                type="content_pending",
                title=f"Nuevo contenido pendiente — {project.name}",
                message=topic,
                project_id=project.id,
                action_url=f"/dashboard/content?id={post.id}",
                action_label="Revisar",
            )
    except Exception as e:
        print(f"[Notifications] Failed to create content_pending notification: {e}")

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

    # Resolve image_url: use explicit single URL, or fall back to first URL in image_urls list
    resolved_image_url = body.image_url or (body.image_urls[0] if body.image_urls else None)
    # Serialize image_urls list as JSON string for storage
    resolved_image_urls = json.dumps(body.image_urls) if body.image_urls else None

    post = ContentPost(
        project_id=project.id,
        format=body.content_type,
        status="pending_approval",
        content={"topic": body.topic, "content_type": body.content_type, "hashtags": body.hashtags},
        image_url=resolved_image_url,
        image_urls=resolved_image_urls,
        caption=full_caption,
        scheduled_at=scheduled,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    try:
        from app.services.notifications import NotificationService
        from app.core.database import AsyncSessionLocal
        post_content = post.content or {}
        topic = post_content.get("topic", body.topic) if isinstance(post_content, dict) else body.topic
        async with AsyncSessionLocal() as notif_db:
            notif_svc = NotificationService(notif_db)
            await notif_svc.create(
                type="content_pending",
                title=f"Nuevo contenido pendiente — {project.name}",
                message=topic,
                project_id=project.id,
                action_url=f"/dashboard/content?id={post.id}",
                action_label="Revisar",
            )
    except Exception as e:
        print(f"[Notifications] Failed to create content_pending notification: {e}")

    # Trigger n8n if project has webhook
    webhook_url = f"{project.n8n_webhook_base_url}/publish-meta" if project.n8n_webhook_base_url else None
    webhook_triggered = False
    if webhook_url:
        try:
            media_list = body.image_urls if body.image_urls else ([body.image_url] if body.image_url else [])
            await n8n_client.trigger_publish(webhook_url, full_caption, media_list, project_slug)
            webhook_triggered = True
        except Exception:
            pass

    return {
        "id": post.id,
        "project_slug": project_slug,
        "status": post.status,
        "caption": post.caption,
        "image_url": post.image_url,
        "image_urls": body.image_urls or [],
        "scheduled_at": str(post.scheduled_at) if post.scheduled_at else None,
        "webhook_triggered": webhook_triggered,
    }


@router.put("/{content_id}")
async def update_content(
    content_id: int,
    body: UpdateContentRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Update a content post.

    When the status transitions to "approved", a webhook is fired to n8n so
    the publish flow can be triggered without Telegram involvement.
    """
    result = await db.execute(select(ContentPost).where(ContentPost.id == content_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {content_id} not found")

    previous_status = post.status

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

    # Fire n8n approval webhook when a post is approved in the app
    if body.status == "approved" and previous_status != "approved":
        proj_result = await db.execute(select(Project).where(Project.id == post.project_id))
        project = proj_result.scalar_one_or_none()
        if project and project.n8n_webhook_base_url:
            webhook_url = f"{project.n8n_webhook_base_url}/post-approved"
            # Derive platform from content metadata; fall back to "instagram"
            content_meta = post.content or {}
            platform = content_meta.get("platform", "instagram") if isinstance(content_meta, dict) else "instagram"
            try:
                await n8n_client.trigger_approval(
                    webhook_url=webhook_url,
                    post_id=post.id,
                    project_slug=project.slug,
                    platform=platform,
                    caption=post.caption or "",
                    media_url=post.image_url,
                )
            except Exception:
                pass  # Never block the approval response if n8n is unreachable

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


@router.post("/{content_id}/generate-image")
async def generate_image_for_post(
    content_id: int,
    body: GenerateImageRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate an AI image for a content post using the project's image provider.

    Deducts 10 credits. Returns the image URL and remaining credits.
    """
    # 1. Load content post
    result = await db.execute(select(ContentPost).where(ContentPost.id == content_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {content_id} not found")

    # 2. Load project
    proj_result = await db.execute(select(Project).where(Project.id == post.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 3. Check credits
    if (project.credits_balance or 0) < 10:
        raise HTTPException(status_code=402, detail="Insufficient credits")

    # 4. Build prompt if not provided
    prompt = body.prompt.strip()
    if not prompt:
        post_content = post.content or {}
        slides = post_content.get("slides", []) if isinstance(post_content, dict) else []
        slide_1 = slides[0] if slides else {}
        headline = slide_1.get("headline", "")
        subtext = slide_1.get("subtext", slide_1.get("body", ""))
        prompt = f"{headline}. {subtext}. Brand: {project.name}.".strip()

    # 5. Resolve image provider from media_config
    media_config = project.media_config or {}
    image_provider_name = media_config.get("image_provider", "ideogram")
    image_provider = get_image_provider(image_provider_name)

    # 6. Generate image — merge request body params into media_config (body overrides project defaults)
    effective_media_config = {**media_config}
    if body.style:
        effective_media_config["image_style"] = body.style
    if body.aspect_ratio:
        effective_media_config["image_aspect_ratio"] = body.aspect_ratio
    if body.color_palette:
        effective_media_config["image_color_palette"] = body.color_palette
    try:
        image_url = await image_provider.generate_image(
            prompt=prompt,
            media_config=effective_media_config,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Image generation failed: {str(e)}")

    # 7. Save image_url to post
    post.image_url = image_url

    # 8. Deduct 10 credits (floor at 0)
    project.credits_balance = max(0, (project.credits_balance or 0) - 10)
    project.credits_used_this_month = (project.credits_used_this_month or 0) + 10

    await db.commit()
    await db.refresh(project)

    return {
        "image_url": image_url,
        "credits_remaining": project.credits_balance,
    }


@router.post("/import-from-meta/{project_slug}")
async def import_from_meta(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Fetch previously published posts from Facebook Page and Instagram and insert them into the DB.

    Skips posts already imported (matched by facebook_post_id or instagram_media_id).
    Returns a summary of how many were imported and how many were skipped.
    """
    # 1. Load project
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # Resolve token: prefer project-level token, fall back to env META_ACCESS_TOKEN
    raw_token = project.meta_access_token or settings.META_ACCESS_TOKEN
    if not raw_token:
        raise HTTPException(status_code=400, detail="Project has no Meta access token configured")

    if not project.facebook_page_id and not project.instagram_account_id:
        raise HTTPException(status_code=400, detail="Project has no Facebook Page ID or Instagram account ID configured")

    # 2. Decrypt token and build Meta client
    access_token = decrypt_token(raw_token)
    meta_client = MetaClient(access_token=access_token)
    pages_service = PagesService(client=meta_client)
    ig_service = InstagramService(client=meta_client)

    imported = 0
    skipped = 0
    errors: list[str] = []

    # 3. Fetch and import Facebook Page posts
    if project.facebook_page_id:
        try:
            fb_response = await pages_service.get_page_posts(project.facebook_page_id, limit=25)
            fb_posts = fb_response.get("data", [])
        except Exception as exc:
            fb_posts = []
            errors.append(f"Facebook fetch failed: {str(exc)}")

        for fb_post in fb_posts:
            post_id = fb_post.get("id", "")
            if not post_id:
                continue

            # Check if already exists by facebook_post_id
            existing = await db.execute(
                select(ContentPost).where(
                    ContentPost.project_id == project.id,
                    ContentPost.facebook_post_id == post_id,
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue

            caption = fb_post.get("message") or fb_post.get("story") or ""
            image_url = fb_post.get("full_picture")

            created_str = fb_post.get("created_time")
            try:
                published_at = datetime.fromisoformat(created_str.replace("Z", "+00:00")) if created_str else None
            except Exception:
                published_at = None

            post = ContentPost(
                project_id=project.id,
                format="single_image" if image_url else "text_post",
                caption=caption,
                image_url=image_url,
                status="published",
                facebook_post_id=post_id,
                published_at=published_at,
                scheduled_at=published_at,  # Use original Meta date so calendar places post correctly
                content={"source": "meta_import", "platform": "facebook", "permalink": fb_post.get("permalink_url")},
            )
            db.add(post)
            imported += 1

    # 4. Fetch and import Instagram media
    if project.instagram_account_id:
        try:
            ig_response = await ig_service.get_media(project.instagram_account_id, limit=25)
            ig_media = ig_response.get("data", [])
        except Exception as exc:
            ig_media = []
            errors.append(f"Instagram fetch failed: {str(exc)}")

        for media in ig_media:
            media_id = media.get("id", "")
            if not media_id:
                continue

            # Check if already exists by instagram_media_id
            existing = await db.execute(
                select(ContentPost).where(
                    ContentPost.project_id == project.id,
                    ContentPost.instagram_media_id == media_id,
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue

            caption = media.get("caption") or ""
            media_type = media.get("media_type", "IMAGE").lower()
            image_url = media.get("media_url") or media.get("thumbnail_url")

            timestamp_str = media.get("timestamp")
            try:
                published_at = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00")) if timestamp_str else None
            except Exception:
                published_at = None

            if media_type == "video":
                fmt = "single_image"  # store video as single_image with thumbnail
            elif media_type == "carousel_album":
                fmt = "carousel"
            else:
                fmt = "single_image"

            post = ContentPost(
                project_id=project.id,
                format=fmt,
                caption=caption,
                image_url=image_url,
                status="published",
                instagram_media_id=media_id,
                published_at=published_at,
                scheduled_at=published_at,  # Use original Meta date so calendar places post correctly
                content={"source": "meta_import", "platform": "instagram", "media_type": media_type, "permalink": media.get("permalink")},
            )
            db.add(post)
            imported += 1

    await db.commit()

    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
        "message": f"Import complete: {imported} new posts imported, {skipped} already existed.",
    }


@router.post("/{content_id}/generate-video")
async def generate_video_for_post(
    content_id: int,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate a short-form video for a content post using the project's video provider.

    Deducts 50 credits. Returns the video URL and remaining credits.
    """
    # 1. Load content post
    result = await db.execute(select(ContentPost).where(ContentPost.id == content_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {content_id} not found")

    # 2. Load project
    proj_result = await db.execute(select(Project).where(Project.id == post.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 3. Resolve video provider from media_config
    media_config = project.media_config or {}
    video_provider_name = media_config.get("video_provider", "kling")
    video_provider = get_video_provider(video_provider_name)

    # 4. Build prompt from post content
    post_content = post.content or {}
    slides = post_content.get("slides", []) if isinstance(post_content, dict) else []
    if slides:
        slide_1 = slides[0]
        headline = slide_1.get("headline", "")
        subtext = slide_1.get("subtext", slide_1.get("body", ""))
        prompt = f"{headline}. {subtext}. Brand: {project.name}.".strip()
    else:
        prompt = f"{post.caption or project.name}. Brand: {project.name}."

    duration = int(media_config.get("video_duration", 5))
    aspect_ratio = media_config.get("video_aspect_ratio", "9:16")

    # 5. Generate video
    video_url = await video_provider.generate_video(
        prompt=prompt,
        image_url=post.image_url,
        duration=duration,
        aspect_ratio=aspect_ratio,
    )

    # 6. Save video_url and deduct credits
    post.video_url = video_url
    project.credits_balance = (project.credits_balance or 0) - 50
    project.credits_used_this_month = (project.credits_used_this_month or 0) + 50
    await db.commit()
    await db.refresh(post)

    return {
        "video_url": video_url,
        "credits_remaining": project.credits_balance,
    }
