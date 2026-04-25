"""Content management endpoints."""
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, get_current_user_optional, get_current_user, assert_project_access
from app.core.config import settings
from app.core.security import decrypt_token, get_project_token
from app.models.content import ContentPost
from app.models.project import Project
from app.services.claude.client import ClaudeClient
from app.services.media.factory import get_image_provider, get_video_provider
from app.services.token_usage import log_token_usage, check_token_limit
from app.services.operation_limiter import (
    check_operation_allowed,
    record_operation,
    get_current_meta_usage,
    check_schedule_conflict,
)
from app.services.meta.client import MetaClient
from app.services.meta.pages import PagesService
from app.services.meta.instagram import InstagramService
from app.services.storage.s3 import S3Service
from app.services.storage.video import convert_image_to_story_video

router = APIRouter()


def _to_naive_utc(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to naive UTC, stripping tzinfo if present."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt

# In-memory recommendation cache: {project_slug: {"data": dict, "generated_at": datetime}}
_recommendation_cache: dict = {}
_CACHE_TTL_SECONDS = 7200  # 2 hours

claude_client = ClaudeClient()
_s3_service: S3Service | None = None

def get_s3_service() -> S3Service:
    global _s3_service
    if _s3_service is None:
        _s3_service = S3Service()
    return _s3_service


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
    image_urls: Optional[list[str]] = None  # per-slide image URLs; replaces stored image_urls array
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
    num_slides: int = Field(default=6, ge=3, le=10)


class AutoGenerateRequest(BaseModel):
    content_type: str = "carousel_6_slides"  # carousel_6_slides | single_image | text_post
    category: Optional[str] = None           # must be one of project.content_config.content_categories
    hint: Optional[str] = None               # short free-text topic hint
    image_mode: str = "ideogram"             # ideogram | placeholder
    num_slides: int = Field(default=6, ge=3, le=10)


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
    _current_user=Depends(get_current_user),
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
                "instagram_media_id": p.instagram_media_id,
                "facebook_post_id": p.facebook_post_id,
            }
            for p in posts
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{project_id}", response_model=list[ContentPostResponse])
async def list_content(
    project_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> list[ContentPost]:
    """List content posts for a project."""
    await assert_project_access(current_user, project_id, db)
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
    current_user=Depends(get_current_user),
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

    # 2b. Check token limit
    if current_user:
        try:
            over_limit, used, limit = await check_token_limit(db, current_user.id)
            if over_limit:
                raise HTTPException(
                    status_code=429,
                    detail=f"Monthly token limit reached ({used:,}/{limit:,} tokens used)",
                )
        except HTTPException:
            raise
        except Exception:
            pass  # never block generation due to limit check failure

    # 2c. Check per-user operation throttle
    if current_user:
        try:
            meta_usage = await get_current_meta_usage(db)
            allowed, reason, retry_after = await check_operation_allowed(
                db, current_user.id, "content_post", meta_usage
            )
            if not allowed:
                raise HTTPException(
                    status_code=429,
                    detail={"reason": reason, "retry_after_seconds": retry_after},
                )
        except HTTPException:
            raise
        except Exception:
            pass  # never block generation due to throttle check failure

    # 3. Validate category against project config (if provided)
    if body.category:
        allowed_cats = (project.content_config or {}).get("content_categories", [])
        if allowed_cats and body.category not in allowed_cats:
            raise HTTPException(
                status_code=422,
                detail=f"Category '{body.category}' not in project content_categories",
            )

    # 4b. Fetch competitor research from cache (48h TTL, no fresh fetch here)
    competitor_ads: list[dict] = []
    if project.meta_access_token:
        from app.services.meta.ad_library import MetaAdLibraryService
        try:
            token = await get_project_token(project, db)
            ad_lib = MetaAdLibraryService()
            competitor_ads = await ad_lib.get_competitor_ads_cached(db, project, token, use_claude_fallback=True)
        except Exception:
            competitor_ads = []  # never block generation due to competitor fetch failure

    # 5. Generate content with Claude
    try:
        content, _gen_usage = await claude_client.generate_content_by_type(
            project,
            content_type=body.content_type,
            category=body.category,
            hint=body.hint,
            competitor_ads=competitor_ads if competitor_ads else None,
            content_config=project.content_config,
            num_slides=body.num_slides,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Claude generation failed: {str(e)}")

    try:
        await log_token_usage(
            db=db,
            user_id=getattr(current_user, "id", None),
            project_id=project.id,
            usage=_gen_usage,
            operation_type="content_generation",
        )
    except Exception:
        pass  # never block generation due to logging failure

    # 6. Caption extraction
    caption = content.get("caption", "")
    hashtags = content.get("hashtags", [])
    if hashtags:
        hashtag_str = " ".join(f"#{t.lstrip('#')}" for t in hashtags)
        caption = f"{caption}\n\n{hashtag_str}".strip()

    # 7. Image handling — branch by content_type
    media_config = project.media_config or {}
    image_url: str = ""
    image_urls: list[str] = []

    if body.content_type == "carousel_6_slides":
        # Determine image provider — always use project media_config as source of truth.
        # image_mode="placeholder" is the only allowed override (for testing/fallback).
        carousel_image_provider = media_config.get("image_provider", "html")
        if body.image_mode == "placeholder":
            carousel_image_provider = "placeholder"

        if carousel_image_provider in ("html", None, "") or carousel_image_provider not in ("ideogram", "placeholder"):
            # HTML renderer — render one slide per carousel entry
            from app.services.media.html_renderer import HTMLSlideRenderer
            renderer = HTMLSlideRenderer()
            slides_data = content.get("slides", [])
            generated_urls: list[str] = []
            effective_media_config = dict(media_config)
            if not effective_media_config.get("brand_handle"):
                effective_media_config["brand_handle"] = project.slug.replace("-", "")
            # Inject brand colors from content_config as fallback when media_config has no override
            _cc = project.content_config or {}
            if not effective_media_config.get("image_bg_color") and _cc.get("brand_bg_color"):
                effective_media_config["brand_bg_color"] = _cc["brand_bg_color"]
            if not effective_media_config.get("image_primary_color") and _cc.get("brand_primary_color"):
                effective_media_config["brand_primary_color"] = _cc["brand_primary_color"]
            logger.info(f"media_config for {project.slug}: {media_config}")
            logger.info(f"image_provider: {media_config.get('image_provider')}")
            logger.info(f"image_bg_color: {media_config.get('image_bg_color')}")
            logger.info(f"image_primary_color: {media_config.get('image_primary_color')}")
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

    elif body.content_type in ("single_image", "image"):
        # Always use project media_config as source of truth.
        # image_mode="placeholder" is the only allowed override (for testing/fallback).
        if body.image_mode == "placeholder":
            effective_provider = "placeholder"
        else:
            effective_provider = media_config.get("image_provider", "html")

        try:
            headline = content.get("headline", "")
            subtext = content.get("subtext", "")
            cta = content.get("cta", "")
            image_prompt = f"{headline}. {subtext}. Brand: {project.name}.".strip()

            if effective_provider in ("html", None, "") or effective_provider not in ("ideogram", "placeholder"):
                # HTML renderer path for single_image
                from app.services.media.html_renderer import HTMLSlideRenderer
                renderer = HTMLSlideRenderer()
                effective_media_config = dict(media_config)
                if not effective_media_config.get("brand_handle"):
                    effective_media_config["brand_handle"] = project_slug.replace("-", "")
                slide_data = {
                    "headline": headline,
                    "subtext": subtext,
                    "cta": cta,
                }
                try:
                    url = await renderer.render_single_image(slide_data, effective_media_config)
                    image_url = url
                    image_urls = [url]
                    project.credits_balance = max(0, (project.credits_balance or 0) - 5)
                    project.credits_used_this_month = (project.credits_used_this_month or 0) + 5
                    await db.commit()
                except Exception as e:
                    logger.warning(f"HTML render failed for single_image, using placeholder: {e}")
                    try:
                        placeholder_url = await get_s3_service().upload_placeholder_image(project_slug)
                        image_url = placeholder_url
                        image_urls = [placeholder_url]
                    except Exception:
                        pass
            elif effective_provider != "placeholder" and (project.credits_balance or 0) >= 10:
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

    elif body.content_type in ("story", "story_vertical"):
        # Story vertical rendering — 1080×1920
        try:
            from app.services.media.html_renderer import HTMLSlideRenderer
            renderer = HTMLSlideRenderer()
            effective_media_config = dict(media_config)
            if not effective_media_config.get("brand_handle"):
                effective_media_config["brand_handle"] = project_slug.replace("-", "")
            slide_data = {
                "hook_text": content.get("hook_text", content.get("headline", "")),
                "body_text": content.get("body_text", content.get("subtext", "")),
                "cta_text": content.get("cta_text", content.get("cta", "")),
            }
            if body.image_mode != "placeholder":
                url = await renderer.render_story(slide_data, effective_media_config)
                image_url = url
                image_urls = [url]
                project.credits_balance = max(0, (project.credits_balance or 0) - 5)
                project.credits_used_this_month = (project.credits_used_this_month or 0) + 5
                await db.commit()
            else:
                try:
                    placeholder_url = await get_s3_service().upload_placeholder_image(project_slug)
                    image_url = placeholder_url
                    image_urls = [placeholder_url]
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"HTML render failed for story_vertical, using placeholder: {e}")
            try:
                placeholder_url = await get_s3_service().upload_placeholder_image(project_slug)
                image_url = placeholder_url
                image_urls = [placeholder_url]
            except Exception:
                pass

    # text_post: no image needed

    webhook_triggered = False

    # 8. Determine DB format field — prefer format from generated content, fall back to request type
    generated_format = content.get("format", "") if isinstance(content, dict) else ""
    if generated_format in ("single_image", "story_vertical", "text_post"):
        db_format = generated_format
    elif body.content_type == "carousel_6_slides":
        db_format = "carousel"
    elif body.content_type in ("single_image", "image"):
        db_format = "single_image"
    elif body.content_type in ("story", "story_vertical"):
        db_format = "story_vertical"
    else:
        db_format = "text_post"

    # 10. Save to DB
    # Extract narrative_angle from generated content (set by generate_content_by_type)
    detected_angle = content.get("narrative_angle") if isinstance(content, dict) else None

    post = ContentPost(
        project_id=project.id,
        format=db_format,
        status="pending_approval",
        content=content,
        image_url=image_url or None,
        image_urls=json.dumps(image_urls) if image_urls else None,
        caption=caption,
        narrative_angle=detected_angle,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    # Record operation for throttle tracking
    if current_user:
        try:
            await record_operation(db, current_user.id, "content_post")
            await db.commit()
        except Exception:
            pass  # never block on record failure

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
    _current_user=Depends(get_current_user),
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
            caption = await claude_client.generate_caption(body.topic, tone, language, config)
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

    # Check schedule conflict when a scheduled_at is provided
    if scheduled is not None:
        try:
            conflict = await check_schedule_conflict(db, project.id, scheduled)
            if conflict:
                raise HTTPException(
                    status_code=409,
                    detail={"reason": "schedule_conflict", "retry_after_seconds": 0},
                )
        except HTTPException:
            raise
        except Exception:
            pass  # never block on conflict check failure

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

    return {
        "id": post.id,
        "project_slug": project_slug,
        "status": post.status,
        "caption": post.caption,
        "image_url": post.image_url,
        "image_urls": body.image_urls or [],
        "scheduled_at": str(post.scheduled_at) if post.scheduled_at else None,
        "webhook_triggered": False,
    }


async def _publish_post_to_meta(post: ContentPost, project: Project, db: AsyncSession) -> None:
    """Publish a content post to Meta (Instagram + Facebook). Updates post.status in place."""
    from app.services.meta.rate_limiter import meta_rate_limiter
    meta_rate_limiter.check_and_record(project.id, "publish")
    try:
        access_token = await get_project_token(project, db)
        if not access_token:
            raise ValueError("No Meta access token configured for this project")

        meta_client = MetaClient(access_token)
        caption = post.caption or ""

        # Resolve image URLs for publishing
        publish_image_urls: list[str] = []
        if post.image_urls:
            try:
                publish_image_urls = json.loads(post.image_urls)
            except (json.JSONDecodeError, TypeError):
                pass
        if not publish_image_urls and post.image_url:
            publish_image_urls = [post.image_url]

        instagram_media_id: str | None = None
        facebook_post_id: str | None = None
        ig_error: Exception | None = None
        fb_error: Exception | None = None

        is_story = post.format == "story_vertical"

        # Publish to Instagram (independent — errors are captured, not raised)
        if project.instagram_account_id and publish_image_urls:
            logger.info(
                "Post %s: attempting Instagram %s publish to account %s (%d image(s))",
                post.id, "story" if is_story else "post", project.instagram_account_id, len(publish_image_urls),
            )
            try:
                ig_service = InstagramService(meta_client)
                if is_story:
                    # Stories must be published as VIDEO — Instagram ignores
                    # media_product_type=STORY for IMAGE containers and always
                    # publishes to the feed instead.  Convert the PNG to a
                    # 5-second MP4 first, then create a VIDEO story container.
                    logger.info("Post %s: converting story image to video for Instagram Story", post.id)
                    s3_svc = S3Service()
                    video_url = await convert_image_to_story_video(publish_image_urls[0], s3_svc)
                    logger.info("Post %s: story video ready at %s", post.id, video_url)
                    container = await ig_service.create_story_container(
                        project.instagram_account_id, video_url
                    )
                    creation_id = container.get("id")
                    if creation_id:
                        await ig_service.wait_for_container(creation_id)
                        published = await ig_service.publish_media(project.instagram_account_id, creation_id)
                        instagram_media_id = published.get("id")
                    else:
                        logger.warning("Post %s: Instagram story container returned no id", post.id)
                elif len(publish_image_urls) > 1:
                    instagram_media_id = await ig_service.publish_carousel(
                        project.instagram_account_id, publish_image_urls, caption
                    )
                else:
                    container = await ig_service.create_media_container(
                        project.instagram_account_id, publish_image_urls[0], caption
                    )
                    creation_id = container.get("id")
                    if creation_id:
                        await ig_service.wait_for_container(creation_id)
                        published = await ig_service.publish_media(project.instagram_account_id, creation_id)
                        instagram_media_id = published.get("id")
                    else:
                        logger.warning("Post %s: Instagram container returned no id", post.id)
                logger.info("Post %s: Instagram published — media_id=%s", post.id, instagram_media_id)
            except Exception as exc:
                ig_error = exc
                logger.warning(
                    "Post %s: Instagram publish failed (non-blocking): %s",
                    post.id, exc, exc_info=True,
                )
        else:
            logger.info(
                "Post %s: skipping Instagram (account_id=%s, image_count=%d)",
                post.id, project.instagram_account_id, len(publish_image_urls),
            )

        # Publish to Facebook Page (independent — 403 is non-blocking)
        # story_vertical posts are skipped on Facebook — Stories API is not
        # generally available via the Graph API for Pages.
        if is_story:
            logger.info("Post %s: skipping Facebook publish for story_vertical content type", post.id)
        elif project.facebook_page_id:
            logger.info(
                "Post %s: attempting Facebook publish to page %s (%d image(s))",
                post.id, project.facebook_page_id, len(publish_image_urls),
            )
            try:
                pages_service = PagesService(meta_client)
                if len(publish_image_urls) > 1:
                    fb_result = await pages_service.publish_carousel(
                        project.facebook_page_id, publish_image_urls, caption
                    )
                else:
                    first_image_url = publish_image_urls[0] if publish_image_urls else None
                    fb_result = await pages_service.publish_post(
                        project.facebook_page_id, caption, first_image_url
                    )
                facebook_post_id = fb_result.get("id")
                logger.info("Post %s: Facebook published — post_id=%s", post.id, facebook_post_id)
            except Exception as exc:
                fb_error = exc
                logger.warning(
                    "Post %s: Facebook publish failed (non-blocking): %s",
                    post.id, exc, exc_info=True,
                )
        else:
            logger.info("Post %s: skipping Facebook (no facebook_page_id configured)", post.id)

        # Audit log — Instagram result
        if project.instagram_account_id and publish_image_urls:
            from app.services.meta.audit import log_meta_operation
            await log_meta_operation(
                db=db,
                project_id=project.id,
                operation="publish_post",
                entity_type="post",
                success=instagram_media_id is not None,
                entity_id=instagram_media_id,
                payload={"platform": "instagram", "post_id": post.id, "image_count": len(publish_image_urls)},
                response_status=200 if instagram_media_id else None,
                error_message=str(ig_error) if ig_error else None,
            )

        # Audit log — Facebook result (skipped for story_vertical)
        if not is_story and project.facebook_page_id:
            from app.services.meta.audit import log_meta_operation
            await log_meta_operation(
                db=db,
                project_id=project.id,
                operation="publish_post",
                entity_type="post",
                success=facebook_post_id is not None,
                entity_id=facebook_post_id,
                payload={"platform": "facebook", "post_id": post.id, "image_count": len(publish_image_urls)},
                response_status=200 if facebook_post_id else None,
                error_message=str(fb_error) if fb_error else None,
            )

        # Determine outcome: published if at least one platform succeeded
        at_least_one_success = instagram_media_id is not None or facebook_post_id is not None
        both_failed = ig_error is not None and fb_error is not None

        if at_least_one_success:
            post.status = "published"
            post.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
            if instagram_media_id:
                post.instagram_media_id = instagram_media_id
            if facebook_post_id:
                post.facebook_post_id = facebook_post_id
            await db.commit()
            await db.refresh(post)
            logger.info(
                "Post %s published to Meta — instagram=%s facebook=%s",
                post.id, instagram_media_id, facebook_post_id,
            )
            # If one platform succeeded but the other failed, log a softer warning + notify
            if ig_error or fb_error:
                failed_platforms_log = []
                if ig_error:
                    failed_platforms_log.append(f"Instagram: {ig_error}")
                if fb_error:
                    failed_platforms_log.append(f"Facebook: {fb_error}")
                logger.warning(
                    "Post %s: partial publish — some platforms failed: %s",
                    post.id, "; ".join(failed_platforms_log),
                )
                if ig_error and not fb_error:
                    partial_fail_message = "Error en publicación en Instagram"
                else:
                    partial_fail_message = "Error en publicación en Facebook"
                try:
                    from app.services.notifications import NotificationService
                    from app.core.database import AsyncSessionLocal
                    async with AsyncSessionLocal() as notif_db:
                        notif_svc = NotificationService(notif_db)
                        await notif_svc.create(
                            type="post_failed",
                            title="Error al publicar en Meta",
                            message=partial_fail_message,
                            project_id=post.project_id,
                            action_url=f"/dashboard/content?id={post.id}",
                            action_label="Revisar",
                        )
                except Exception as notif_exc:
                    logger.error("Failed to create partial publish-failure notification: %s", notif_exc)
        elif both_failed:
            logger.error(
                "Post %s: all platforms failed — instagram_error=%s, facebook_error=%s",
                post.id, ig_error, fb_error,
            )
            # Keep status as "approved" so the operator can retry
            try:
                from app.services.notifications import NotificationService
                from app.core.database import AsyncSessionLocal
                async with AsyncSessionLocal() as notif_db:
                    notif_svc = NotificationService(notif_db)
                    await notif_svc.create(
                        type="post_failed",
                        title="Error al publicar en Meta",
                        message="Error en publicación en Instagram y Facebook",
                        project_id=post.project_id,
                        action_url=f"/dashboard/content?id={post.id}",
                        action_label="Revisar",
                    )
            except Exception as notif_exc:
                logger.error("Failed to create publish-failure notification: %s", notif_exc)
        else:
            # No platforms configured or no images — mark published anyway
            logger.info(
                "Post %s: no platforms attempted (no account IDs or no image), marking published",
                post.id,
            )
            post.status = "published"
            post.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await db.commit()
            await db.refresh(post)

    except Exception as exc:
        logger.error("Failed to publish post %s to Meta: %s", post.id, exc, exc_info=True)
        # Keep status as "approved" so the operator can retry; create a notification
        try:
            from app.services.notifications import NotificationService
            from app.core.database import AsyncSessionLocal
            async with AsyncSessionLocal() as notif_db:
                notif_svc = NotificationService(notif_db)
                await notif_svc.create(
                    type="post_failed",
                    title="Error al publicar en Meta",
                    message="Error en publicación en Instagram y Facebook",
                    project_id=post.project_id,
                    action_url=f"/dashboard/content?id={post.id}",
                    action_label="Revisar",
                )
        except Exception as notif_exc:
            logger.error("Failed to create publish-failure notification: %s", notif_exc)


@router.put("/{content_id}")
async def update_content(
    content_id: int,
    body: UpdateContentRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Update a content post.

    When the status transitions to "approved", the post is published directly
    to Meta (Instagram + Facebook).
    """
    result = await db.execute(select(ContentPost).where(ContentPost.id == content_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {content_id} not found")

    # IDOR check: verify the post's project is accessible to the current user
    if current_user.role not in ("super_admin",):
        if current_user.role == "admin":
            proj_check = await db.execute(select(Project).where(Project.id == post.project_id))
            owned_project = proj_check.scalar_one_or_none()
            if owned_project is None or owned_project.owner_id != current_user.id:
                raise HTTPException(status_code=403, detail="Not authorized for this content post")
        else:
            from app.models.user_project import UserProject
            user_projects = await db.execute(
                select(UserProject.project_id).where(UserProject.user_id == current_user.id)
            )
            authorized_ids = {row[0] for row in user_projects.fetchall()}
            if post.project_id not in authorized_ids:
                raise HTTPException(status_code=403, detail="Not authorized for this content post")

    previous_status = post.status

    if body.caption is not None or body.hashtags is not None:
        # Recompute the stored caption whenever either caption text or hashtags change.
        # Use the incoming value when provided, otherwise fall back to what is already stored.
        base_caption = body.caption if body.caption is not None else (post.caption or "")
        # Strip any previously appended hashtag block so we don't double-append.
        # Hashtags are always appended after "\n\n#", so trim from the first occurrence.
        if "\n\n#" in base_caption:
            base_caption = base_caption[:base_caption.index("\n\n#")].rstrip()
        new_hashtags = body.hashtags if body.hashtags is not None else []
        hashtags_str = " ".join(f"#{tag.lstrip('#')}" for tag in new_hashtags) if new_hashtags else ""
        post.caption = f"{base_caption}\n\n{hashtags_str}".strip() if hashtags_str else base_caption
    if body.image_url is not None:
        post.image_url = body.image_url
    if body.image_urls is not None:
        post.image_urls = json.dumps(body.image_urls)
        # Keep image_url in sync with the first slide
        if body.image_urls:
            post.image_url = body.image_urls[0]
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

    # Publish directly to Meta when a post is approved in the app
    if body.status == "approved" and previous_status != "approved":
        proj_result = await db.execute(select(Project).where(Project.id == post.project_id))
        project = proj_result.scalar_one_or_none()
        if project:
            # If scheduled_at is in the future, don't publish yet — scheduler will handle it
            if post.scheduled_at and _to_naive_utc(post.scheduled_at) > datetime.now(timezone.utc).replace(tzinfo=None):
                # Just save approved status, scheduler will publish at the right time
                pass
            else:
                # Publish immediately (no schedule, or schedule is in the past)
                await _publish_post_to_meta(post, project, db)

    # Parse image_urls JSON string back to a list for the response
    parsed_image_urls: list[str] = []
    if post.image_urls:
        try:
            parsed_image_urls = json.loads(post.image_urls)
        except (json.JSONDecodeError, TypeError):
            if post.image_url:
                parsed_image_urls = [post.image_url]

    return {
        "id": post.id,
        "status": post.status,
        "caption": post.caption,
        "image_url": post.image_url,
        "image_urls": parsed_image_urls,
        "scheduled_at": str(post.scheduled_at) if post.scheduled_at else None,
        "content": post.content,
        "instagram_media_id": post.instagram_media_id,
        "facebook_post_id": post.facebook_post_id,
    }


@router.delete("/posts/{post_id}")
async def delete_content_post(
    post_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Delete a content post.

    Not allowed if the post has already been published.
    Checks that the post belongs to a project accessible by the current user.
    """
    result = await db.execute(select(ContentPost).where(ContentPost.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {post_id} not found")

    # IDOR check: verify the post's project is accessible to the current user
    if current_user.role not in ("super_admin",):
        if current_user.role == "admin":
            proj_check = await db.execute(select(Project).where(Project.id == post.project_id))
            owned_project = proj_check.scalar_one_or_none()
            if owned_project is None or owned_project.owner_id != current_user.id:
                raise HTTPException(status_code=403, detail="Not authorized for this content post")
        else:
            from app.models.user_project import UserProject
            user_projects = await db.execute(
                select(UserProject.project_id).where(UserProject.user_id == current_user.id)
            )
            authorized_ids = {row[0] for row in user_projects.fetchall()}
            if post.project_id not in authorized_ids:
                raise HTTPException(status_code=403, detail="Not authorized for this content post")

    if post.status == "published":
        raise HTTPException(status_code=400, detail="Cannot delete a post that has already been published")

    await db.delete(post)
    await db.commit()
    return {"ok": True}


@router.post("/{content_id}/retry-instagram")
async def retry_instagram(
    content_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Retry publishing a post to Instagram only.

    Useful when a post was published to Facebook successfully but Instagram
    returned a 500 or similar transient error. Does not re-publish to Facebook.
    """
    result = await db.execute(select(ContentPost).where(ContentPost.id == content_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {content_id} not found")

    await assert_project_access(current_user, post.project_id, db)

    if post.status not in ("published", "approved", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Post is in status '{post.status}'. Only published/approved/failed posts can be retried.",
        )

    proj_result = await db.execute(select(Project).where(Project.id == post.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    access_token = await get_project_token(project, db)
    if not access_token:
        raise HTTPException(status_code=400, detail="No Meta access token configured for this project")

    if not project.instagram_account_id:
        raise HTTPException(status_code=400, detail="No Instagram account ID configured for this project")

    # Resolve image URLs
    publish_image_urls: list[str] = []
    if post.image_urls:
        try:
            publish_image_urls = json.loads(post.image_urls)
        except (json.JSONDecodeError, TypeError):
            pass
    if not publish_image_urls and post.image_url:
        publish_image_urls = [post.image_url]

    if not publish_image_urls:
        raise HTTPException(status_code=400, detail="Post has no images to publish")

    caption = post.caption or ""

    try:
        meta_client = MetaClient(access_token)
        ig_service = InstagramService(meta_client)

        if len(publish_image_urls) > 1:
            instagram_media_id = await ig_service.publish_carousel(
                project.instagram_account_id, publish_image_urls, caption
            )
        else:
            container = await ig_service.create_media_container(
                project.instagram_account_id, publish_image_urls[0], caption
            )
            creation_id = container.get("id")
            if not creation_id:
                raise ValueError("Instagram container returned no id")
            await ig_service.wait_for_container(creation_id)
            published = await ig_service.publish_media(project.instagram_account_id, creation_id)
            instagram_media_id = published.get("id")

        if not instagram_media_id:
            raise ValueError("Instagram publish returned no media id")

        post.instagram_media_id = instagram_media_id
        if post.status != "published":
            post.status = "published"
            post.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()
        await db.refresh(post)

        logger.info("Post %s: Instagram retry successful — media_id=%s", post.id, instagram_media_id)
        return {"success": True, "instagram_media_id": instagram_media_id}

    except Exception as exc:
        logger.error("Post %s: Instagram retry failed: %s", post.id, exc, exc_info=True)
        try:
            from app.services.notifications import NotificationService
            from app.core.database import AsyncSessionLocal
            async with AsyncSessionLocal() as notif_db:
                notif_svc = NotificationService(notif_db)
                await notif_svc.create(
                    type="post_failed",
                    title="Error al reintentar Instagram",
                    message=f"No se pudo publicar el post {content_id} en Instagram: {exc}",
                    project_id=post.project_id,
                    action_url=f"/dashboard/content?id={content_id}",
                    action_label="Revisar",
                )
        except Exception as notif_exc:
            logger.error("Failed to create retry-instagram notification: %s", notif_exc)
        raise HTTPException(status_code=500, detail=f"Instagram publish failed: {exc}")


@router.post("/{content_id}/retry-facebook")
async def retry_facebook(
    content_id: int,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Retry publishing a post to Facebook only.

    Useful when a post was published to Instagram successfully but the Facebook
    page publish failed. Does not re-publish to Instagram.
    """
    result = await db.execute(select(ContentPost).where(ContentPost.id == content_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {content_id} not found")

    if post.status not in ("published", "approved", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Post is in status '{post.status}'. Only published/approved/failed posts can be retried.",
        )

    proj_result = await db.execute(select(Project).where(Project.id == post.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    access_token = await get_project_token(project, db)
    if not access_token:
        raise HTTPException(status_code=400, detail="No Meta access token configured for this project")

    if not project.facebook_page_id:
        raise HTTPException(status_code=400, detail="No Facebook page ID configured for this project")

    # Resolve image URLs
    publish_image_urls: list[str] = []
    if post.image_urls:
        try:
            publish_image_urls = json.loads(post.image_urls)
        except (json.JSONDecodeError, TypeError):
            pass
    if not publish_image_urls and post.image_url:
        publish_image_urls = [post.image_url]

    if not publish_image_urls:
        raise HTTPException(status_code=400, detail="Post has no images to publish")

    caption = post.caption or ""

    try:
        meta_client = MetaClient(access_token)
        pages_service = PagesService(meta_client)

        if len(publish_image_urls) > 1:
            fb_result = await pages_service.publish_carousel(
                project.facebook_page_id, publish_image_urls, caption
            )
        else:
            fb_result = await pages_service.publish_post(
                project.facebook_page_id, caption, publish_image_urls[0]
            )

        facebook_post_id = fb_result.get("id")
        if not facebook_post_id:
            raise ValueError("Facebook publish returned no post id")

        if post.status != "published":
            post.status = "published"
            post.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()
        await db.refresh(post)

        logger.info("Post %s: Facebook retry successful — post_id=%s", post.id, facebook_post_id)
        return {"success": True, "facebook_post_id": facebook_post_id}

    except Exception as exc:
        logger.error("Post %s: Facebook retry failed: %s", post.id, exc, exc_info=True)
        try:
            from app.services.notifications import NotificationService
            from app.core.database import AsyncSessionLocal
            async with AsyncSessionLocal() as notif_db:
                notif_svc = NotificationService(notif_db)
                await notif_svc.create(
                    type="post_failed",
                    title="Error al reintentar Facebook",
                    message=f"No se pudo publicar el post {content_id} en Facebook: {exc}",
                    project_id=post.project_id,
                    action_url=f"/dashboard/content?id={content_id}",
                    action_label="Revisar",
                )
        except Exception as notif_exc:
            logger.error("Failed to create retry-facebook notification: %s", notif_exc)
        raise HTTPException(status_code=500, detail=f"Facebook publish failed: {exc}")


@router.post("/batch/{project_slug}")
async def batch_generate_content(
    project_slug: str,
    body: BatchContentRequest,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Generate multiple content posts for a batch plan."""
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # Check per-user operation throttle (once for the whole batch)
    if _current_user:
        try:
            meta_usage = await get_current_meta_usage(db)
            allowed, reason, retry_after = await check_operation_allowed(
                db, _current_user.id, "content_post", meta_usage
            )
            if not allowed:
                raise HTTPException(
                    status_code=429,
                    detail={"reason": reason, "retry_after_seconds": retry_after},
                )
        except HTTPException:
            raise
        except Exception:
            pass  # never block generation due to throttle check failure

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
        # Check schedule conflict for this slot
        try:
            conflict = await check_schedule_conflict(db, project.id, sched_dt)
            if conflict:
                raise HTTPException(
                    status_code=409,
                    detail={"reason": "schedule_conflict", "retry_after_seconds": 0},
                )
        except HTTPException:
            raise
        except Exception:
            pass  # never block on conflict check failure

        try:
            content, _batch_usage = await claude_client.generate_carousel_content(project, num_slides=body.num_slides)
            try:
                await log_token_usage(
                    db=db,
                    user_id=None,
                    project_id=project.id,
                    usage=_batch_usage,
                    operation_type="batch_generation",
                )
            except Exception:
                pass  # never block generation due to logging failure
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

    # Record one operation log entry for the batch
    if _current_user:
        try:
            await record_operation(db, _current_user.id, "content_post")
            await db.commit()
        except Exception:
            pass  # never block on record failure

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
    _current_user=Depends(get_current_user),
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


class RerenderSlideRequest(BaseModel):
    slide_index: int  # 0-based


@router.post("/{content_id}/rerender-slide")
async def rerender_slide(
    content_id: int,
    body: RerenderSlideRequest,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Re-render a single carousel slide using the HTML renderer.

    Uses the existing slide content (headline/body) from the ContentPost and the
    project's media_config (colors, fonts). Uploads the new PNG to S3 and updates
    post.image_urls[slide_index] in place.

    Returns: { "image_url": "<new_url>", "slide_index": <index> }
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

    # 3. Validate slide_index
    post_content = post.content or {}
    if isinstance(post_content, str):
        try:
            post_content = json.loads(post_content)
        except Exception:
            post_content = {}
    slides = post_content.get("slides", []) if isinstance(post_content, dict) else []
    if not slides:
        raise HTTPException(status_code=400, detail="ContentPost has no slides")
    if body.slide_index < 0 or body.slide_index >= len(slides):
        raise HTTPException(
            status_code=422,
            detail=f"slide_index {body.slide_index} out of range (0–{len(slides) - 1})",
        )

    # 4. Build slide_data for the renderer
    slide = slides[body.slide_index]
    slide_data = {
        "headline": slide.get("headline", ""),
        # "body" is used by content slides, "subtext" by hook slides, "cta" by close slides
        "subtext": slide.get("body", slide.get("subtext", slide.get("cta", ""))),
        "slide_number": body.slide_index + 1,
        "total_slides": len(slides),
        # Pass slide type so Claude-generated HTML can apply the correct layout
        "type": slide.get("type", "content"),
    }

    # 5. Build effective media_config (same as carousel generation)
    media_config = project.media_config or {}
    effective_media_config = dict(media_config)
    if not effective_media_config.get("brand_handle"):
        effective_media_config["brand_handle"] = project.slug.replace("-", "")

    # 6. Render via HTMLSlideRenderer
    from app.services.media.html_renderer import HTMLSlideRenderer
    renderer = HTMLSlideRenderer()
    try:
        new_url = await renderer.render_slide(slide_data, effective_media_config)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Slide render failed: {str(e)}")

    # 7. Update post.image_urls[slide_index]
    existing_urls: list[str] = []
    if post.image_urls:
        try:
            existing_urls = json.loads(post.image_urls) if isinstance(post.image_urls, str) else list(post.image_urls)
        except Exception:
            existing_urls = []
    # Ensure list is long enough
    while len(existing_urls) <= body.slide_index:
        existing_urls.append("")
    existing_urls[body.slide_index] = new_url
    post.image_urls = json.dumps(existing_urls)
    # Keep image_url in sync with slide 0
    if body.slide_index == 0:
        post.image_url = new_url

    await db.commit()

    return {"image_url": new_url, "slide_index": body.slide_index}


@router.post("/import-from-meta/{project_slug}")
async def import_from_meta(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
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

    if not project.facebook_page_id and not project.instagram_account_id:
        raise HTTPException(status_code=400, detail="Project has no Facebook Page ID or Instagram account ID configured")

    # 2. Resolve token via 3-tier resolution and build Meta client
    access_token = await get_project_token(project, db)
    if not access_token:
        raise HTTPException(status_code=400, detail="Project has no Meta access token configured")
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
                _dt = datetime.fromisoformat(created_str.replace("Z", "+00:00")) if created_str else None
                published_at = _to_naive_utc(_dt)
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
                _dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00")) if timestamp_str else None
                published_at = _to_naive_utc(_dt)
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


@router.post("/import/{project_slug}")
async def import_instagram_posts(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Import published Instagram posts into the DB.

    Fetches media from the project's instagram_account_id via Meta Graph API.
    Skips posts already imported (matched by instagram_media_id).
    Returns {"imported": N, "skipped": N}.
    """
    # 1. Load project
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    if not project.instagram_account_id:
        raise HTTPException(
            status_code=400,
            detail="Project has no instagram_account_id configured",
        )

    # Resolve access token via 3-tier resolution
    access_token = await get_project_token(project, db)
    if not access_token:
        raise HTTPException(status_code=400, detail="Project has no Meta access token configured")

    # 2. Fetch Instagram media with like/comment counts
    meta_client = MetaClient(access_token=access_token)
    try:
        ig_response = await meta_client.get(
            f"/{project.instagram_account_id}/media",
            {
                "fields": "id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count",
                "limit": 50,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Meta API error: {str(exc)}")

    ig_media = ig_response.get("data", [])

    imported = 0
    skipped = 0

    # 3. Process each media item
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
        like_count = media.get("like_count", 0) or 0
        comments_count = media.get("comments_count", 0) or 0

        timestamp_str = media.get("timestamp")
        try:
            published_at = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00")) if timestamp_str else None
        except Exception:
            published_at = None

        # Map media_type to format
        if media_type == "video":
            fmt = "single_image"
        elif media_type == "carousel_album":
            fmt = "carousel"
        else:
            fmt = "post"

        post = ContentPost(
            project_id=project.id,
            format=fmt,
            caption=caption,
            image_url=image_url,
            status="published",
            instagram_media_id=media_id,
            published_at=published_at,
            scheduled_at=published_at,
            content={
                "source": "meta_import",
                "platform": "instagram",
                "media_type": media_type,
                "platform_metrics": {"likes": like_count, "comments": comments_count},
            },
        )
        db.add(post)
        imported += 1

    await db.commit()

    return {"imported": imported, "skipped": skipped}


class CreateStoryRequest(BaseModel):
    image_url: str
    caption: Optional[str] = None
    scheduled_at: Optional[datetime] = None


@router.post("/create-story/{project_slug}")
async def create_instagram_story(
    project_slug: str,
    body: CreateStoryRequest,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Publish an Instagram Story for a project.

    Creates a media container then publishes it via Meta Graph API.
    Saves the result as a ContentPost with content_type='story'.
    Returns {"success": True, "story_id": story_id}.
    """
    # 1. Load project
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    if not project.instagram_account_id:
        raise HTTPException(
            status_code=400,
            detail="Project has no instagram_account_id configured — required for Stories",
        )

    access_token = await get_project_token(project, db)
    if not access_token:
        raise HTTPException(status_code=400, detail="Project has no Meta access token configured")

    meta_client = MetaClient(access_token=access_token)
    ig_account_id = project.instagram_account_id

    # 2. Create media container
    container_params: dict = {
        "image_url": body.image_url,
        "media_type": "IMAGE",
    }
    if body.caption:
        container_params["caption"] = body.caption

    try:
        container_resp = await meta_client.post(
            f"/{ig_account_id}/media",
            container_params,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Meta API error creating media container: {str(exc)}")

    media_id = container_resp.get("id")
    if not media_id:
        raise HTTPException(status_code=502, detail="Meta API did not return a media container id")

    # 3. Publish the media container
    try:
        publish_resp = await meta_client.post(
            f"/{ig_account_id}/media_publish",
            {"creation_id": media_id},
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Meta API error publishing story: {str(exc)}")

    story_id = publish_resp.get("id", media_id)

    # 4. Save ContentPost
    published_at = body.scheduled_at or datetime.now(timezone.utc).replace(tzinfo=None)
    post = ContentPost(
        project_id=project.id,
        format="story",
        caption=body.caption or "",
        image_url=body.image_url,
        status="published",
        instagram_media_id=story_id,
        published_at=published_at,
        scheduled_at=published_at,
        content={"source": "story", "platform": "instagram", "media_type": "story"},
    )
    db.add(post)
    await db.commit()

    return {"success": True, "story_id": story_id}


@router.post("/{content_id}/generate-video")
async def generate_video_for_post(
    content_id: int,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
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


class RecommendTodayRequest(BaseModel):
    force_refresh: bool = False


@router.post("/recommend-today/{project_slug}")
async def recommend_today(
    project_slug: str,
    body: RecommendTodayRequest = RecommendTodayRequest(),
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Generate a 'what to post today' recommendation using post history and competitor analysis."""
    from datetime import datetime, timezone

    # Check cache first (unless force_refresh)
    if not body.force_refresh:
        cached = _recommendation_cache.get(project_slug)
        if cached:
            age = (datetime.now(timezone.utc) - cached["generated_at"]).total_seconds()
            if age < _CACHE_TTL_SECONDS:
                return {
                    "recommendation": cached["data"].get("recommendation"),
                    "competitive_insight": cached["data"].get("competitive_insight"),
                    "quick_actions": cached["data"].get("quick_actions"),
                    "generated_at": cached["generated_at"].isoformat(),
                    "cached": True,
                }

    # Load project
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Load last 10 posts
    posts_result = await db.execute(
        select(ContentPost)
        .where(ContentPost.project_id == project.id)
        .order_by(ContentPost.created_at.desc())
        .limit(10)
    )
    recent_posts_raw = posts_result.scalars().all()
    recent_posts = [
        {
            "created_at": p.created_at.strftime("%Y-%m-%d") if p.created_at else "",
            "format": p.format or "",
            "content": p.content or {},
            "status": p.status or "",
            "narrative_angle": p.narrative_angle or "",
        }
        for p in recent_posts_raw
    ]

    # Load competitor ads (if competitors configured)
    competitor_ads = []
    config = project.content_config or {}
    competitors_raw = config.get("competitors", "")
    if competitors_raw and project.meta_access_token:
        try:
            from app.services.meta.ad_library import MetaAdLibraryService
            competitors_list = [c.strip() for c in competitors_raw.split(",") if c.strip()]
            if competitors_list:
                access_token = await get_project_token(project, db)
                ad_lib = MetaAdLibraryService()
                competitor_ads = await ad_lib.get_competitor_ads(
                    access_token=access_token,
                    competitors=competitors_list,
                )
        except Exception:
            # Competitor ads are optional — fail silently
            competitor_ads = []

    # Generate recommendation via Claude
    try:
        result_data = await claude_client.generate_content_recommendation(
            project=project,
            recent_posts=recent_posts,
            competitor_ads=competitor_ads,
            posting_timezone=(project.content_config or {}).get("posting_timezone", "UTC"),
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to generate recommendation: {str(e)}")

    # Store in cache
    now = datetime.now(timezone.utc)
    _recommendation_cache[project_slug] = {
        "data": result_data,
        "generated_at": now,
    }

    return {
        "recommendation": result_data.get("recommendation"),
        "competitive_insight": result_data.get("competitive_insight"),
        "quick_actions": result_data.get("quick_actions"),
        "generated_at": now.isoformat(),
        "cached": False,
    }
