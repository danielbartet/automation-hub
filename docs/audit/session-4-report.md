# Audit Report — Session 4: Async Patterns & SQLite Concurrency

**Date:** 2026-04-19
**Scope:** `backend/` — async sessions, APScheduler jobs, SQLite concurrency, Apify/Claude cache races, general async footguns

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 3 |
| HIGH | 3 |
| MEDIUM | 6 |
| LOW | 11 |

| Area | Findings |
|---|---|
| 1 — Async sessions | 5 |
| 2 — APScheduler | 4 |
| 3 — SQLite concurrency | 4 |
| 4 — Competitor cache (48h TTL) | 4 |
| 5 — Apify integration | 2 |
| 6 — General async footguns | 7 |

## CRITICAL

### C1. ClaudeClient uses synchronous Anthropic client inside async def
**File:** `backend/app/services/claude/client.py:54` (and sites `:218, :382, :559, :744, :888, :989, :1073`)
**Severity:** CRITICAL
**Area:** General async footguns (6.1)

**Current code (constructor, line 54):**
```python
class ClaudeClient:
    """Wrapper for Anthropic Claude API calls."""

    MODEL = "claude-sonnet-4-6"

    def __init__(self) -> None:
        self.client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        self._last_usage: dict = {}
```

**Current code (example call site, line 382):**
```python
    async def generate_content(self, prompt: str, system_prompt: str = "") -> str:
        """Generate text content — generic helper."""
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=1000,
            system=system_prompt or "You are a helpful assistant.",
            messages=[{"role": "user", "content": prompt}],
        )
        self._last_usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
```

**Why it's risky:** Every Claude call (3-15s) blocks the entire FastAPI event loop. During those seconds no HTTP request is served, no APScheduler job ticks, no async DB session progresses. A 10-campaign optimizer cycle freezes the app for ~2 minutes.

**Recommended fix:**
```python
from anthropic import AsyncAnthropic
self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
# at every call site:
response = await self.client.messages.create(...)
```
All 7 call sites need `await` added. Mechanical but touches every Claude method.

### C2. SQLite engine has no WAL, no busy_timeout
**File:** `backend/app/core/database.py:6-9`
**Severity:** CRITICAL
**Area:** SQLite concurrency (3.1)

**Current code:**
```python
"""Async SQLAlchemy database engine and session factory."""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)
```

**Why it's risky:** No `journal_mode=WAL` → writers block readers and vice versa. No `busy_timeout` → concurrent writer returns SQLITE_BUSY immediately as a 500. Any optimizer commit freezes every dashboard request for the duration. This is the single highest-ROI fix.

**Recommended fix:**
```python
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
    connect_args={"timeout": 30},
)

from sqlalchemy import event
@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()
```

### C3. asyncio.gather shares single AsyncSession across parallel tasks
**File:** `backend/app/api/v1/health.py:87-99`
**Severity:** CRITICAL
**Area:** Async sessions (1.1)

**Current code:**
```python
    async def _safe_health(p: Project) -> dict:
        try:
            return await get_project_health(db, p.id)
        except Exception as exc:
            return {
                "project_id": p.id,
                "project_name": p.name,
                "health_color": "red",
                "error": str(exc),
                "is_stale": True,
            }

    results = await asyncio.gather(*[_safe_health(p) for p in projects])
    return list(results)
```

**Why it's risky:** AsyncSession is NOT task-safe. `get_project_health` does `db.execute` + `db.commit`. Running N of them in parallel on the same session raises `IllegalStateChangeError` / "Session is already in a transaction" as soon as a user has 2+ projects and visits the health endpoint.

**Recommended fix:**
```python
async def _safe_health(p: Project) -> dict:
    async with AsyncSessionLocal() as task_db:
        try:
            return await get_project_health(task_db, p.id)
        except Exception as exc:
            return {"project_id": p.id, "error": str(exc)}
```

## HIGH

### H1. APScheduler jobs have no max_instances/coalesce/misfire_grace_time
**File:** `backend/app/main.py:80-262`
**Severity:** HIGH
**Area:** APScheduler (2.1)

**Current code (scheduled_posts_job add_job, around line 123-128):**
```python
    scheduler.add_job(
        scheduled_posts_job,
        IntervalTrigger(minutes=5),
        id="scheduled_posts",
        replace_existing=True,
    )
```

**Why it's risky:** `scheduled_posts_job` runs every 5 min. If a run exceeds 5 min (Meta latency, many posts), APScheduler launches a second instance in parallel. Both SELECT the same `status='approved'` posts → **double-posting to Instagram/Facebook**. Not idempotent. Also applies to `optimization_job`, `sync_campaign_statuses_job`, `weekly_ads_audit`.

**Recommended fix:**
```python
scheduler.add_job(
    scheduled_posts_job,
    IntervalTrigger(minutes=5),
    id="scheduled_posts",
    replace_existing=True,
    max_instances=1,
    coalesce=True,
    misfire_grace_time=60,
)
```
Apply to every job.

### H2. Competitor cache miss does not dedupe concurrent fetches
**File:** `backend/app/services/meta/ad_library.py:338-461`
**Severity:** HIGH
**Area:** Competitor cache (4.1)

**Current code (cache lookup around 356-369):**
```python
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)

        # Check cache
        result = await db.execute(
            select(CompetitorResearchCache).where(
                CompetitorResearchCache.project_id == project.id
            )
        )
        cache = result.scalar_one_or_none()

        fetched_at = cache.fetched_at if cache else None
        if fetched_at and fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        if cache and fetched_at > cutoff:
```

**Current code (cache write, around 444-461):**
```python
        # Upsert cache (without analysis yet)
        now = datetime.now(timezone.utc)
        research_json = {"ads": ads}
        if is_synthetic:
            research_json["_synthetic"] = True
        if cache:
            cache.research_json = research_json
            cache.analysis_json = None
            cache.fetched_at = now
        else:
            cache = CompetitorResearchCache(
                project_id=project.id,
                research_json=research_json,
                analysis_json=None,
                fetched_at=now,
            )
            db.add(cache)
        await db.commit()
```

**Why it's risky:** Two calls arrive simultaneously with empty/stale cache. Both call `get_competitor_ads_apify` (30-60s each), both try to INSERT `CompetitorResearchCache`. Unique constraint on `project_id` (competitor_cache.py:19) → second insert raises `UNIQUE constraint failed` as a 500. Doubled Apify billing.

**Recommended fix:** In-process `asyncio.Lock` keyed by project_id, or DB-level "in_flight_since" marker. Simplest:
```python
_cache_locks: dict[int, asyncio.Lock] = {}
lock = _cache_locks.setdefault(project.id, asyncio.Lock())
async with lock:
    # existing cache lookup + fetch + write
```

### H3. Apify calls have no WIP marker — same race as H2
**File:** `backend/app/services/meta/ad_library.py` — `_apify_fetch_one` and callers
**Severity:** HIGH
**Area:** Apify integration (5.1)

**Current code (grep for `_apify_fetch_one` def):**
```python
    async def _apify_fetch_one(
        self,
        client: httpx.AsyncClient,
        api_key: str,
        competitor: str,
        limit: int,
        timeout: int,
    ) -> list[dict]:
        """Start an Apify actor run for one competitor, wait, and return mapped ads."""

        # Start actor run
        start_resp = await client.post(
            f"{APIFY_BASE_URL}/acts/{APIFY_ACTOR_ID}/runs",
            params={"token": api_key},
            json={
```

**Why it's risky:** User rapid-clicks "Refresh" on Inspiration tab → 3 parallel Apify actor runs, each billed per run. Same mitigation as H2.

**Recommended fix:** Same `asyncio.Lock` keyed by `(project_id, competitor)`.

## MEDIUM

### M1. Optimizer loop has no per-campaign try/except
**File:** `backend/app/services/ads/optimizer.py:716-741`
**Severity:** MEDIUM
**Area:** APScheduler (2.2)

**Current code:**
```python
async def run_optimization_cycle(db: AsyncSession) -> list[dict]:
    """Run optimization for all active campaigns that haven't been checked in 3 days."""
    from datetime import timedelta

    cutoff = datetime.utcnow() - timedelta(days=3)

    result = await db.execute(
        select(AdCampaign).where(
            AdCampaign.status == "active",
            AdCampaign.meta_campaign_id.isnot(None),
            (AdCampaign.last_optimized_at == None) | (AdCampaign.last_optimized_at <= cutoff)
        )
    )
    campaigns = result.scalars().all()
    print(f"[Optimizer] Found {len(campaigns)} eligible campaigns (cutoff: {cutoff})")

    results = []
    for campaign in campaigns:
        print(f"[Optimizer] Processing campaign {campaign.id} — {campaign.name}")
        proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
        project = proj_result.scalar_one_or_none()
        if project:
            r = await analyze_campaign(campaign, project, db)
            results.append(r)

    return results
```

**Why it's risky:** One campaign failing inside `analyze_campaign` aborts the entire cycle. Session may be in inconsistent state because previous iteration committed but failing iteration's `db.add(log)` ran before commit. Subsequent calls surface errors from wrong iteration.

**Recommended fix:** Wrap loop body in try/except with `await db.rollback()` on failure.

### M2. Scheduler jobs share single AsyncSession across work units
**File:** `backend/app/main.py:94-128` (scheduled_posts_job)
**Severity:** MEDIUM
**Area:** APScheduler (2.3)

**Current code:**
```python
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
```

**Why it's risky:** `_publish_post_to_meta` commits in-place. If one post's commit fails, session is in failed transaction — all subsequent iterations fail until rollback. Worse: `_publish_post_to_meta` opens nested `AsyncSessionLocal` contexts for notifications, potentially deadlocking on SQLite file lock.

**Recommended fix:** Open new session per post inside loop, or `await db.rollback()` in except.

### M3. Optimizer SCALE approval vs user update_budget race
**File:** `backend/app/api/v1/ads.py:1830-1842` (update_budget) and `:1889-1902` (optimizer_approve)
**Severity:** MEDIUM
**Area:** SQLite concurrency (3.2)

**Current code (update_budget):**
```python
    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    token = await get_project_token(project, db) if project else ""

    if token and campaign.meta_adset_id:
        await meta_service.update_adset_budget(token, campaign.meta_adset_id, body.daily_budget)
    elif token and campaign.meta_campaign_id:
        await meta_service.update_campaign_budget(token, campaign.meta_campaign_id, body.daily_budget)

    campaign.daily_budget = body.daily_budget
    await db.commit()
    return {"id": campaign.id, "daily_budget": campaign.daily_budget}
```

**Current code (optimizer_approve):**
```python
    if action == "scale":
        new_budget = action_data.get("new_budget", campaign.daily_budget)
        if token and campaign.meta_adset_id:
            await meta_svc.update_adset_budget(token, campaign.meta_adset_id, new_budget)
        elif token and campaign.meta_campaign_id:
            await meta_svc.update_campaign_budget(token, campaign.meta_campaign_id, new_budget)
        else:
            import logging
            logging.getLogger(__name__).warning(
                "optimizer_approve: no meta_adset_id or meta_campaign_id for campaign %s — DB updated but Meta skipped",
                campaign.id,
            )
        campaign.daily_budget = new_budget
        result_msg = f"Budget increased to ${new_budget}/day"
```

**Why it's risky:** Both paths SELECT AdCampaign → UPDATE daily_budget. No version column. User edits budget $10→$15 while optimizer SCALE approves $10→$12. Last write wins; Meta and DB diverge.

**Recommended fix:** Add `version: int` column to AdCampaign. UPDATE ... WHERE id=? AND version=? in both paths.

### M4. scheduled_posts_job SELECT+publish pattern widens after enabling WAL
**File:** `backend/app/main.py:87-128`, `backend/app/api/v1/content.py:615`
**Severity:** MEDIUM (HIGH after C2 fix)
**Area:** SQLite concurrency (3.3)

**Current code (scheduled posts loop):**
```python
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
```

**Why it's risky:** Selects `status='approved' AND scheduled_at <= now`, iterates, publishes. User manual publish between SELECT and publish call → double-post to Meta. Currently mitigated by rollback-journal serialization; WAL removes that mitigation.

**Recommended fix:**
```python
result = await db.execute(
    update(ContentPost)
    .where(ContentPost.id == post.id, ContentPost.status == 'approved')
    .values(status='publishing')
)
if result.rowcount != 1:
    continue  # another worker got it
# proceed to publish
```

### M5. No backend throttle on Claude generation endpoints
**File:** `backend/app/api/v1/ads.py:137` (competitor-ads), `backend/app/api/v1/content.py:197` (generate)
**Severity:** MEDIUM
**Area:** Apify integration (5.2)

**Current code (content.py:197 signature):**
```python
@router.post("/generate/{project_slug}")
async def generate_content(
    project_slug: str,
    body: AutoGenerateRequest = AutoGenerateRequest(),
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> dict:
    """Generate content for a project using Claude.

    Supports content_type: carousel_6_slides | single_image | text_post
    Optional category and hint guide Claude's output.
```

**Why it's risky:** Rapid-click → 3 Claude generations + 3 HTMLSlideRenderer passes (each spawns Chromium). Burns credits and CPU.

**Recommended fix:** `manual_refresh_lock` pattern already used in `health.py:18` (30-min DB-backed rate limit per project/action).

### M6. optimizer_approve/reject scans all unread notifications
**File:** `backend/app/api/v1/ads.py:1857-1867` (approve), `:1941-1948` (reject)
**Severity:** MEDIUM
**Area:** Async sessions (1.2)

**Current code (approve):**
```python
    # Find notification with this approval token
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
        )
    )
    notif = None
    for n in result.scalars().all():
        if n.action_data and n.action_data.get("approval_token") == approval_token:
            notif = n
            break
```

**Current code (reject):**
```python
    approval_token = body.get("approval_token")
    result = await db.execute(
        select(Notification).where(Notification.user_id == current_user.id)
    )
    notif = None
    for n in result.scalars().all():
        if n.action_data and n.action_data.get("approval_token") == approval_token:
            notif = n
            break
```

**Why it's risky:** Loads every unread notification per user, iterates in Python looking for `approval_token` in JSON column. Cannot be SQLite-indexed on JSON. `optimizer_reject` does NOT filter `is_read==False` — rejected tokens can be re-rejected silently.

**Recommended fix:** Filter by `type.in_([...])` and `is_read==False` in both. Long-term: promote `approval_token` to a column with unique index.

## LOW

### L1. Nested AsyncSessionLocal inside content publishing
**File:** `backend/app/api/v1/content.py:615` called from `:882` and `backend/app/main.py:117`; also `content.py:507, 590, 739, 760, 789, 1032, 1126`
**Severity:** LOW
**Area:** Async sessions (1.3)

**Current code (example around 739):**
```python
                try:
                    from app.services.notifications import NotificationService
                    from app.core.database import AsyncSessionLocal
                    async with AsyncSessionLocal() as notif_db:
                        notif_svc = NotificationService(notif_db)
                        await notif_svc.create(
                            type="post_failed",
                            title="Error al publicar en Meta",
```

**Why it's risky:** Main session commits; nested `async with AsyncSessionLocal() as notif_db:` runs inside. In SQLite without WAL, second writer in same process contends with outer session locks. With default busy_timeout=0, may see SQLITE_BUSY immediately. Works today because outer has usually committed by then — fragile.

**Recommended fix:** Pass active session into notification helper, or ensure parent commit before opening nested. C2 (WAL) makes this reliable.

### L2. No eager loading — widespread N+1 potential
**File:** `backend/app/api/v1/content.py:181`, `backend/app/api/v1/ads.py:228-258`, `backend/app/api/v1/dashboard.py`
**Severity:** LOW
**Area:** Async sessions (1.4)

**Current code (ads.py list_campaigns, around 228):**
```python
    result = await db.execute(
        select(AdCampaign)
        .where(AdCampaign.project_id == project_id)
        .order_by(AdCampaign.created_at.desc())
    )
    campaigns = result.scalars().all()

    # Load project to get token/account
    proj_result = await db.execute(select(Project).where(Project.id == project_id))
    project = proj_result.scalar_one_or_none()
```

**Why it's risky:** No `selectinload`/`joinedload` except `ads_audit.py:314, :391`. Models have relationships (Project.competitor_cache). Works today because `expire_on_commit=False` and serializers use primitive fields. Adding relationship access to serializers silently triggers MissingGreenlet under SQLAlchemy 2.0 async.

**Recommended fix:** Use `selectinload` when accessing relationships after commit.

### L3. Dashboard endpoint issues 8+ sequential queries
**File:** `backend/app/api/v1/dashboard.py:192-294`
**Severity:** LOW
**Area:** Async sessions (1.5)

**Current code (relevant loop snippet):**
```python
    posts_week_result = await db.execute(
        select(func.count(ContentPost.id)).where(
            ContentPost.project_id == project.id,
            ContentPost.created_at >= week_ago,
        )
    )
    posts_week_count = posts_week_result.scalar_one() or 0

    posts_month_result = await db.execute(
        select(func.count(ContentPost.id)).where(
            ContentPost.project_id == project.id,
            ContentPost.created_at >= month_ago,
        )
    )
```

**Why it's risky:** Per-campaign serial Meta API calls (2 each). 10 campaigns = 20 sequential HTTP round-trips = 5-15s page loads. Five content counts should be one GROUP BY.

**Recommended fix:** `asyncio.gather` for per-campaign fetches (no DB shared), combine counts into single query.

### L4. In-memory jobstore — scheduled state lost on restart
**File:** `backend/app/main.py:68`
**Severity:** LOW
**Area:** APScheduler (2.4)

**Current code:**
```python
    # Start optimization scheduler — runs daily at 08:00 UTC, per-campaign cooldown: 3 days
    scheduler = AsyncIOScheduler()

    async def optimization_job():
        from app.services.ads.optimizer import run_optimization_cycle
```

**Why it's risky:** All jobs re-added via `replace_existing=True`. Fine as long as no ad-hoc jobs are added at runtime.

**Recommended fix:** No change unless dynamic scheduling is planned.

### L5. SQLite has no advisory locks — no mitigation documented
**File:** Whole codebase
**Severity:** LOW
**Area:** SQLite concurrency (3.4)

**Why it's risky:** Code relies on SQLite implicit whole-DB write lock. Postgres migration will expose every missing `SELECT FOR UPDATE`.

**Recommended fix:** Before Postgres migration, audit all fetch→decide→write patterns; add explicit locks or conditional UPDATEs.

### L6. Cache-hit-with-empty-ads triggers fresh Claude
**File:** `backend/app/services/meta/ad_library.py:371-392`
**Severity:** LOW
**Area:** Competitor cache (4.2)

**Current code:**
```python
            # Cache hit but empty — try Claude fallback only for organic content
            if not ads and use_claude_fallback and not cache.research_json.get("_synthetic"):
                config = project.content_config or {}
                competitors_raw = config.get("competitors", "")
                competitors_list = [
                    c.strip().lstrip("@")
                    for c in competitors_raw.replace("\n", ",").split(",")
                    if c.strip()
                ]
                if competitors_list:
                    try:
                        from app.services.claude.client import ClaudeClient
                        ads = await ClaudeClient().research_competitors_by_name(
                            competitors=competitors_list,
                            brand_config=config,
                        )
                        if ads:
                            cache.research_json = {"ads": ads, "_synthetic": True}
                            cache.analysis_json = [ad.get("analysis") for ad in ads if ad.get("analysis")]
                            await db.commit()
                    except Exception as e:
                        logger.warning("Claude competitor fallback failed (cache hit): %s", e)
```

**Why it's risky:** Cache within TTL but `ads==[]` and `use_claude_fallback=True` → fires Claude and commits. Two concurrent callers each run Claude. Same race as H2 for tokens instead of Apify.

**Recommended fix:** Same lock as H2.

### L7. Cache hit with ads but no analysis_json re-runs Claude analysis
**File:** `backend/app/services/meta/ad_library.py:393-405`
**Severity:** LOW
**Area:** Competitor cache (4.3)

**Current code:**
```python
            if cache.analysis_json is not None:
                return self._merge_analysis(ads, cache.analysis_json)
            # Cache hit but no analysis — run analysis now
            try:
                from app.services.claude.client import ClaudeClient
                analyses = await ClaudeClient().analyze_competitor_ads(
                    ads=ads, brand_config=project.content_config or {}
                )
                cache.analysis_json = analyses
                await db.commit()
                return self._merge_analysis(ads, analyses)
            except Exception:
                return ads
```

**Why it's risky:** Two concurrent requests with `analysis_json is None` both run `analyze_competitor_ads` — doubled Claude token cost.

**Recommended fix:** Same lock as H2.

### L8. Timezone handling on fetched_at
**File:** `backend/app/services/meta/ad_library.py:366-369`
**Severity:** LOW
**Area:** Competitor cache (4.4)

**Current code:**
```python
        fetched_at = cache.fetched_at if cache else None
        if fetched_at and fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        if cache and fetched_at > cutoff:
```

**Why it's risky:** `.replace(tzinfo=utc)` assumes stored time is UTC. If any path writes local-time naive datetime, TTL calc is wrong. Current writes use `datetime.now(timezone.utc)` — safe today, document it.

**Recommended fix:** Standardize all writes to `datetime.now(timezone.utc)` and add test.

### L9. Module-level ClaudeClient singleton with mutable _last_usage
**File:** `backend/app/services/ads/optimizer.py:18-19`, `backend/app/services/ads/campaign_chat.py:14-15`, `backend/app/api/v1/ads.py:22`
**Severity:** LOW
**Area:** General async footguns (6.2)

**Current code (optimizer.py):**
```python
meta_service = MetaCampaignService()
claude_client = ClaudeClient()

ANDROMEDA_SYSTEM_PROMPT = """You are an expert Meta Ads optimizer following the Andromeda algorithm rules.

ANDROMEDA RULES:
```

**Why it's risky:** `ClaudeClient._last_usage` is mutated per call (client.py:236). Concurrent requests reading `_last_usage` in `log_token_usage` (content.py:271) interleave and log the wrong project/operation.

**Recommended fix:** Return usage from each method: `return text, usage_dict` instead of storing on self.

### L10. Long audit uses FastAPI BackgroundTasks
**File:** `backend/app/api/v1/ads_audit.py:183, 263-268`
**Severity:** LOW
**Area:** General async footguns (6.3)

**Current code:**
```python
    background_tasks.add_task(
        _run_audit_background,
        audit.id,
        project.id,
        meta_campaign_id,
    )
```

**Why it's risky:** Runs after response sent but inside worker process. If worker restarts mid-audit, no retry. Startup handler (main.py:46-65) cleans up "stale running audits" older than 10 min as mitigation.

**Recommended fix:** Current stale-cleanup is acceptable. For robustness use APScheduler one-off job or a task queue.

### L11. Process-local _recommendation_cache dict
**File:** `backend/app/api/v1/content.py:31-33, 1812-1822, 1879-1883`
**Severity:** LOW
**Area:** General async footguns (6.4)

**Current code (cache declaration around 31):**
```python
# In-memory recommendation cache: {project_slug: {"data": dict, "generated_at": datetime}}
_recommendation_cache: dict = {}
_CACHE_TTL_SECONDS = 7200  # 2 hours

claude_client = ClaudeClient()
```

**Why it's risky:** Python dict writes are atomic per op but not "check-then-set". OK for single-process async; breaks under `uvicorn --workers N` (per-worker cache).

**Recommended fix:** If moving to multi-worker, move to DB or Redis.

### L12. APScheduler exception swallowing drops stack traces
**File:** `backend/app/main.py:77-78, 119-121, 185-186, 254-255`
**Severity:** LOW
**Area:** General async footguns (6.6)

**Current code (example around 77-78):**
```python
            except Exception as e:
                print(f"[Optimizer] Error: {e}")
```

**Why it's risky:** `print(f"[X] Error: {e}")` loses traceback. Production failures are undiagnosable.

**Recommended fix:** `logger.exception(...)` instead of print.

### L13. No startup assertion for ANTHROPIC_API_KEY
**File:** `backend/app/services/claude/client.py:54`, `backend/app/main.py:31`
**Severity:** LOW
**Area:** General async footguns (6.7)

**Current code (client.py:54):**
```python
    def __init__(self) -> None:
        self.client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        self._last_usage: dict = {}
```

**Why it's risky:** If secret is missing, app starts "fine"; every Claude call 401s deep in request handling. main.py asserts JWT_SECRET at startup but not ANTHROPIC_API_KEY.

**Recommended fix:** Add `assert settings.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY missing"` to main.py startup.

## Appendix: Priority fix order

1. **C2 (SQLite WAL + busy_timeout)** — one-line change, eliminates most contention-induced 500s
2. **C1 (AsyncAnthropic)** — mechanical, unfreezes event loop across all Claude calls
3. **H1 + M4 (scheduler max_instances=1 + conditional UPDATE for publish)** — prevents double-posting to IG/FB
4. **H2 + H3 + L6 + L7 (per-project asyncio.Lock on Apify/Claude cache)** — stops doubled API billing and unique-constraint 500s
5. **C3 (health.py per-task session)** — prevents `IllegalStateChangeError` on health endpoint

## Appendix: Files requiring changes

- `backend/app/core/database.py` — C2
- `backend/app/services/claude/client.py` — C1, L13
- `backend/app/main.py` — H1, M2, L4, L12, L13
- `backend/app/services/meta/ad_library.py` — H2, H3, L6, L7, L8
- `backend/app/api/v1/health.py` — C3
- `backend/app/services/ads/optimizer.py` — M1, L9
- `backend/app/api/v1/content.py` — M4, M5, L1, L11
- `backend/app/api/v1/ads.py` — M3, M5, M6, L9
- `backend/app/api/v1/dashboard.py` — L3
- `backend/app/services/ads/campaign_chat.py` — L9
- `backend/app/api/v1/ads_audit.py` — L10
- `backend/app/api/v1/content.py`, `ads.py`, `dashboard.py` — L2 (N+1)
- `backend/alembic/env.py` — C2 (if running migrations, pragmas should also apply)
