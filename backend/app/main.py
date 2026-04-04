"""Automation Hub — FastAPI application entry point."""
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router

scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.database import init_db, seed_db, AsyncSessionLocal
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger

    global scheduler
    await init_db()
    await seed_db()

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
    )

    async def scheduled_posts_job():
        """Publish posts that are approved and whose scheduled_at has passed."""
        from app.models.content import ContentPost
        from app.models.project import Project
        from app.api.v1.content import _publish_post_to_meta
        from sqlalchemy import select, and_

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
    )
    scheduler.start()
    print("[Scheduler] Campaign optimizer started — runs daily at 08:00 UTC, per-campaign cooldown: 3 days")
    print("[Scheduler] Scheduled posts publisher started — runs every 5 minutes")

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
