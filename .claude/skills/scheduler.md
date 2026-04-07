---
name: scheduler
description: "ALWAYS use this skill for ANY task involving scheduled or periodic jobs in the FastAPI backend. Load it whenever: setting up publication schedules, configuring cron jobs, scheduling content generation, setting up periodic metric refresh, or any time-based automation. Use APScheduler with AsyncIOScheduler — never Celery for this project."
---

# Scheduler Skill

## Recommended library: APScheduler with AsyncIOScheduler
No Redis, no separate workers, no extra infrastructure.
Runs in the same async process as FastAPI.

## Install
Add to pyproject.toml: apscheduler>=3.10.0

## Setup in main.py
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def start_scheduler():
    # Load active schedules from DB and register them
    schedules = await load_active_schedules()
    for schedule in schedules:
        scheduler.add_job(
            generate_and_publish_content,
            CronTrigger(
                day_of_week=schedule.days_of_week,
                hour=schedule.hour,
                minute=0,
                timezone=schedule.timezone
            ),
            id=f"content_{schedule.project_slug}",
            args=[schedule.project_slug],
            replace_existing=True
        )
    scheduler.start()

@app.on_event("shutdown")
async def stop_scheduler():
    scheduler.shutdown()
```

## Add/remove jobs dynamically (when user saves schedule in dashboard)
```python
# Add new job
scheduler.add_job(
    func=generate_and_publish_content,
    trigger=CronTrigger(day_of_week="mon,wed,fri", hour=9, timezone="America/Argentina/Buenos_Aires"),
    id=f"content_{project_slug}",
    args=[project_slug],
    replace_existing=True
)

# Remove job
scheduler.remove_job(f"content_{project_slug}")

# Pause job
scheduler.pause_job(f"content_{project_slug}")

# Resume job
scheduler.resume_job(f"content_{project_slug}")
```

## ContentSchedule DB model
```python
class ContentSchedule(Base):
    __tablename__ = "content_schedules"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"))
    days_of_week = Column(String)  # "mon,wed,fri" or "1,3,5"
    hour = Column(Integer)         # 0-23
    timezone = Column(String, default="America/Argentina/Buenos_Aires")
    posts_per_period = Column(Integer, default=1)
    content_type = Column(String, default="carousel_6_slides")
    is_active = Column(Boolean, default=True)
    starts_at = Column(DateTime)
    ends_at = Column(DateTime, nullable=True)
    on_expire = Column(String, default="pause")  # pause, notify, renew
    created_at = Column(DateTime, server_default=func.now())
```

## Common cron patterns
```python
# Every weekday at 9am Buenos Aires time
CronTrigger(day_of_week="mon-fri", hour=9, timezone="America/Argentina/Buenos_Aires")

# Mon, Wed, Fri at 10am
CronTrigger(day_of_week="mon,wed,fri", hour=10, timezone="America/Argentina/Buenos_Aires")

# Once a week on Monday at 9am
CronTrigger(day_of_week="mon", hour=9, timezone="America/Argentina/Buenos_Aires")

# Every day at 8am
CronTrigger(hour=8, timezone="America/Argentina/Buenos_Aires")
```

## Important: APScheduler vs Celery decision
Use APScheduler (this project) when:
- Tasks are I/O bound (API calls, DB writes)
- Single server deployment
- No need for distributed workers

Switch to Celery only if:
- Thousands of concurrent jobs
- Multi-server deployment
- Tasks take more than 5 minutes