"""Automation Hub — FastAPI application entry point."""
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router
import app.models.competitor_cache  # noqa: F401 — registers CompetitorResearchCache with SQLAlchemy before Project resolves relationships
import app.models.user_meta_token  # noqa: F401 — registers UserMetaToken with SQLAlchemy at startup
import app.models.token_usage  # noqa: F401 — registers TokenUsageLog and UserTokenLimit with SQLAlchemy at startup

scheduler = None


_INSECURE_JWT_DEFAULTS = {
    "change-this-in-production-use-long-random-string",
    "change-this-in-production",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.database import init_db, seed_db, AsyncSessionLocal
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger

    global scheduler

    # Security assertions — fail fast if secrets are insecure defaults
    if settings.JWT_SECRET in _INSECURE_JWT_DEFAULTS:
        raise RuntimeError(
            "JWT_SECRET is set to an insecure default value. "
            "Set a strong secret in .env before starting."
        )
    if hasattr(settings, "META_OAUTH_STATE_SECRET") and settings.META_OAUTH_STATE_SECRET in _INSECURE_JWT_DEFAULTS:
        raise RuntimeError(
            "META_OAUTH_STATE_SECRET is set to an insecure default value. "
            "Set a strong secret in .env before starting."
        )

    await init_db()
    await seed_db()

    # Clean up stale running audits from previous app restarts
    async with AsyncSessionLocal() as db:
        from datetime import timedelta
        from sqlalchemy import select, update
        from app.models.ads_audit import AdsAudit

        stale_cutoff = datetime.utcnow() - timedelta(minutes=10)
        result = await db.execute(
            select(AdsAudit).where(
                AdsAudit.status.in_(["running", "pending"]),
                AdsAudit.created_at < stale_cutoff
            )
        )
        stale_audits = result.scalars().all()
        for audit in stale_audits:
            audit.status = "error"
            audit.error_message = "Audit timed out — cleaned up on startup"
            audit.completed_at = datetime.utcnow()
        if stale_audits:
            await db.commit()
            print(f"[Startup] Cleaned up {len(stale_audits)} stale audit(s)")

    # Start optimization scheduler — runs daily at 08:00 UTC, per-campaign cooldown: 3 days
    scheduler = AsyncIOScheduler()

    async def optimization_job():
        from app.services.ads.optimizer import run_optimization_cycle
        print("[Optimizer] Job triggered")
        async with AsyncSessionLocal() as db:
            try:
                results = await run_optimization_cycle(db)
                print(f"[Optimizer] Done — {len(results)} campaigns processed: {[r.get('decision') for r in results]}")
            except Exception as e:
                print(f"[Optimizer] Error: {e}")

    scheduler.add_job(
        optimization_job,
        CronTrigger(hour=8, minute=0),
        id="campaign_optimizer",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )

    async def scheduled_posts_job():
        """Publish posts that are approved and whose scheduled_at has passed."""
        from app.models.content import ContentPost
        from app.models.project import Project
        from app.api.v1.content import _publish_post_to_meta
        from sqlalchemy import select, and_, update

        async with AsyncSessionLocal() as db:
            try:
                now = datetime.utcnow()
                # Find approved posts with scheduled_at <= now
                result = await db.execute(
                    select(ContentPost).where(
                        and_(
                            ContentPost.status == "approved",
                            ContentPost.scheduled_at != None,  # noqa: E711
                            ContentPost.scheduled_at <= now,
                        )
                    )
                )
                posts = result.scalars().all()

                for post in posts:
                    try:
                        # Atomically claim this post for publishing
                        claim_result = await db.execute(
                            update(ContentPost)
                            .where(
                                ContentPost.id == post.id,
                                ContentPost.status == "approved",
                            )
                            .values(status="publishing")
                        )
                        await db.commit()
                        if claim_result.rowcount != 1:
                            continue  # Another worker already claimed it

                        proj_result = await db.execute(
                            select(Project).where(Project.id == post.project_id)
                        )
                        project = proj_result.scalar_one_or_none()
                        if project:
                            print(f"[Scheduler] Publishing scheduled post {post.id}")
                            await _publish_post_to_meta(post, project, db)
                    except Exception as e:
                        print(f"[Scheduler] Failed to publish post {post.id}: {e}")
            except Exception as e:
                print(f"[Scheduler] Scheduled posts job error: {e}")

    scheduler.add_job(
        scheduled_posts_job,
        IntervalTrigger(minutes=5),
        id="scheduled_posts",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )

    async def run_weekly_audit_for_all_projects():
        """Weekly audit job — runs every Monday at 07:00 UTC for all projects with ad_account_id."""
        from app.models.ads_audit import AdsAudit
        from app.models.project import Project
        from app.services.ads.audit import MetaAuditService
        from app.core.security import get_project_token
        from sqlalchemy import select
        from datetime import timedelta

        async with AsyncSessionLocal() as db:
            try:
                # Get all active projects with ad_account_id configured
                result = await db.execute(
                    select(Project).where(
                        Project.ad_account_id.isnot(None),
                        Project.is_active == True,  # noqa: E712
                    )
                )
                projects = result.scalars().all()

                for project in projects:
                    # Skip if a recent audit exists (within last 6 days)
                    recent_cutoff = datetime.utcnow() - timedelta(days=6)
                    recent_result = await db.execute(
                        select(AdsAudit).where(
                            AdsAudit.project_id == project.id,
                            AdsAudit.status.in_(["completed", "partial"]),
                            AdsAudit.created_at > recent_cutoff,
                        ).limit(1)
                    )
                    if recent_result.scalar_one_or_none():
                        print(f"[AuditScheduler] Skipping {project.slug} — recent audit exists")
                        continue

                    # Check token available
                    token = await get_project_token(project, db)
                    if not token:
                        print(f"[AuditScheduler] Skipping {project.slug} — no token")
                        continue

                    # Create audit row and run
                    audit = AdsAudit(
                        project_id=project.id,
                        ad_account_id=project.ad_account_id,
                        status="running",
                        triggered_by="scheduler",
                    )
                    db.add(audit)
                    await db.commit()
                    await db.refresh(audit)

                    print(f"[AuditScheduler] Running audit for {project.slug}")
                    async with MetaAuditService(token, project.ad_account_id, project.id) as svc:
                        await svc.run(audit.id, db)

            except Exception as e:
                print(f"[AuditScheduler] Error in weekly audit job: {e}")

    scheduler.add_job(
        run_weekly_audit_for_all_projects,
        CronTrigger(day_of_week="mon", hour=7, minute=0),
        id="weekly_ads_audit",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )

    async def sync_campaign_statuses_job():
        """Sync AdCampaign.status with Meta effective_status every 6 hours."""
        from app.models.ad_campaign import AdCampaign
        from app.models.project import Project
        from app.core.security import get_project_token
        from app.services.ads.meta_campaign import MetaCampaignService
        from sqlalchemy import select

        meta_service = MetaCampaignService()

        async with AsyncSessionLocal() as db:
            try:
                # Load all campaigns that have a meta_campaign_id
                result = await db.execute(
                    select(AdCampaign).where(AdCampaign.meta_campaign_id.isnot(None))
                )
                campaigns = result.scalars().all()

                if not campaigns:
                    print("[StatusSync] No campaigns with meta_campaign_id — skipping")
                    return

                # Group campaigns by project_id to minimise token lookups
                project_ids = list({c.project_id for c in campaigns})
                proj_result = await db.execute(
                    select(Project).where(Project.id.in_(project_ids))
                )
                projects_by_id = {p.id: p for p in proj_result.scalars().all()}

                updated_count = 0
                for campaign in campaigns:
                    project = projects_by_id.get(campaign.project_id)
                    if not project:
                        continue
                    token = await get_project_token(project, db)
                    if not token:
                        continue
                    try:
                        effective_status = await meta_service.fetch_effective_status(
                            token, campaign.meta_campaign_id
                        )
                        if effective_status is None:
                            continue
                        # Meta returns uppercase; DB stores lowercase
                        new_status = effective_status.lower()
                        if campaign.status != new_status:
                            print(
                                f"[StatusSync] Campaign {campaign.meta_campaign_id} "
                                f"status: {campaign.status!r} → {new_status!r}"
                            )
                            campaign.status = new_status
                            updated_count += 1
                    except Exception as e:
                        print(f"[StatusSync] Error syncing campaign {campaign.meta_campaign_id}: {e}")

                if updated_count:
                    await db.commit()
                print(f"[StatusSync] Done — {updated_count}/{len(campaigns)} campaigns updated")

            except Exception as e:
                print(f"[StatusSync] Job error: {e}")

    scheduler.add_job(
        sync_campaign_statuses_job,
        IntervalTrigger(hours=6),
        id="campaign_status_sync",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )

    scheduler.start()
    print("[Scheduler] Campaign optimizer started — runs daily at 08:00 UTC, per-campaign cooldown: 3 days")
    print("[Scheduler] Scheduled posts publisher started — runs every 5 minutes")
    print("[Scheduler] Weekly ads audit started — runs every Monday at 07:00 UTC")
    print("[Scheduler] Campaign status sync started — runs every 6 hours")

    yield

    if scheduler:
        scheduler.shutdown()


app = FastAPI(
    title="Automation Hub API",
    description="Multi-project content automation and Meta Ads management platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://frontend:3000",
        "https://hub.quantorialabs.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}
