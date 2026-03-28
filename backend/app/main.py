"""Automation Hub — FastAPI application entry point."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router

scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.database import init_db, seed_db, AsyncSessionLocal
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.interval import IntervalTrigger

    global scheduler
    await init_db()
    await seed_db()

    # Start optimization scheduler — runs every 3 days
    scheduler = AsyncIOScheduler()

    async def optimization_job():
        from app.services.ads.optimizer import run_optimization_cycle
        async with AsyncSessionLocal() as db:
            try:
                results = await run_optimization_cycle(db)
                if results:
                    print(f"[Optimizer] Processed {len(results)} campaigns: {[r.get('decision') for r in results]}")
            except Exception as e:
                print(f"[Optimizer] Error: {e}")

    scheduler.add_job(
        optimization_job,
        IntervalTrigger(days=3),
        id="campaign_optimizer",
        replace_existing=True,
    )
    scheduler.start()
    print("[Scheduler] Campaign optimizer started — runs every 3 days")

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
