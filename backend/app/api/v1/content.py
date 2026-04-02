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
from app.services.storage.s3 import S3Service

router = APIRouter()

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
        # Always use project media_config as source of truth.
        # image_mode="placeholder" is the only allowed override (for testing/fallback).
        if body.image_mode == "placeholder":
            effective_provider = "placeholder"
        else:
            effective_provider = media_config.get("image_provider", "html")

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

    webhook_triggered = False

    # 8. Determine DB format field
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


@router.put("/{content_id}")
async def update_content(
    content_id: int,
    body: UpdateContentRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Update a content post.

    When the status transitions to "approved", the post is published directly
    to Meta (Instagram + Facebook).
    """
    result = await db.execute(select(ContentPost).where(ContentPost.id == content_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail=f"ContentPost {content_id} not found")

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
            try:
                access_token = decrypt_token(project.meta_access_token) if project.meta_access_token else None
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

                first_image_url = publish_image_urls[0] if publish_image_urls else None

                instagram_media_id: str | None = None
                facebook_post_id: str | None = None
                ig_error: Exception | None = None
                fb_error: Exception | None = None

                # Publish to Instagram (independent — errors are captured, not raised)
                if project.instagram_account_id and first_image_url:
                    logger.info(
                        "Post %s: attempting Instagram publish to account %s",
                        post.id, project.instagram_account_id,
                    )
                    try:
                        ig_service = InstagramService(meta_client)
                        container = await ig_service.create_media_container(
                            project.instagram_account_id, first_image_url, caption
                        )
                        creation_id = container.get("id")
                        if creation_id:
                            await ig_service.wait_for_container(creation_id)
                            published = await ig_service.publish_media(project.instagram_account_id, creation_id)
                            instagram_media_id = published.get("id")
                            logger.info("Post %s: Instagram published — media_id=%s", post.id, instagram_media_id)
                        else:
                            logger.warning("Post %s: Instagram container returned no id", post.id)
                    except Exception as exc:
                        ig_error = exc
                        logger.warning(
                            "Post %s: Instagram publish failed (non-blocking): %s",
                            post.id, exc, exc_info=True,
                        )
                else:
                    logger.info(
                        "Post %s: skipping Instagram (account_id=%s, first_image_url=%s)",
                        post.id, project.instagram_account_id, first_image_url,
                    )

                # Publish to Facebook Page (independent — 403 is non-blocking)
                if project.facebook_page_id:
                    logger.info(
                        "Post %s: attempting Facebook publish to page %s",
                        post.id, project.facebook_page_id,
                    )
                    try:
                        pages_service = PagesService(meta_client)
                        fb_result = await pages_service.publish_post(project.facebook_page_id, caption, first_image_url)
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

                # Determine outcome: published if at least one platform succeeded
                at_least_one_success = instagram_media_id is not None or facebook_post_id is not None
                both_failed = ig_error is not None and fb_error is not None

                if at_least_one_success:
                    post.status = "published"
                    post.published_at = datetime.utcnow()
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
                    # If one platform succeeded but the other failed, log a softer warning
                    if ig_error or fb_error:
                        failed_platforms = []
                        if ig_error:
                            failed_platforms.append(f"Instagram: {ig_error}")
                        if fb_error:
                            failed_platforms.append(f"Facebook: {fb_error}")
                        logger.warning(
                            "Post %s: partial publish — some platforms failed: %s",
                            post.id, "; ".join(failed_platforms),
                        )
                elif both_failed:
                    logger.error(
                        "Post %s: all platforms failed — instagram_error=%s, facebook_error=%s",
                        post.id, ig_error, fb_error,
                    )
                    # Keep status as "approved" so the operator can retry
                    combined_error = f"Instagram: {ig_error} | Facebook: {fb_error}"
                    try:
                        from app.services.notifications import NotificationService
                        from app.core.database import AsyncSessionLocal
                        async with AsyncSessionLocal() as notif_db:
                            notif_svc = NotificationService(notif_db)
                            await notif_svc.create(
                                type="post_failed",
                                title="Error al publicar en Meta",
                                message=f"Post #{post.id}: {combined_error}",
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
                    post.published_at = datetime.utcnow()
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
                            message=f"Post #{post.id}: {exc}",
                            project_id=post.project_id,
                            action_url=f"/dashboard/content?id={post.id}",
                            action_label="Revisar",
                        )
                except Exception as notif_exc:
                    logger.error("Failed to create publish-failure notification: %s", notif_exc)

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


@router.post("/import/{project_slug}")
async def import_instagram_posts(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
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

    # Resolve and decrypt access token
    raw_token = project.meta_access_token or settings.META_ACCESS_TOKEN
    if not raw_token:
        raise HTTPException(status_code=400, detail="Project has no Meta access token configured")
    access_token = decrypt_token(raw_token)

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

    raw_token = project.meta_access_token or settings.META_ACCESS_TOKEN
    if not raw_token:
        raise HTTPException(status_code=400, detail="Project has no Meta access token configured")
    access_token = decrypt_token(raw_token)

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
    published_at = body.scheduled_at or datetime.utcnow()
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
