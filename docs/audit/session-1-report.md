# Security Audit Report — Session 1

**Date:** 2026-04-19
**Scope:** Code added/changed in the last 3 days on `main`
**Auditor:** Claude (Opus 4.7 verification pass after initial Sonnet 4.6 scan)

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 5 |
| HIGH | 14 |
| MEDIUM | 8 |
| LOW | 7 |

## CRITICAL

### C1. `ads.py:1811` — `PUT /{campaign_id}/budget` unauthenticated
**File:** `backend/app/api/v1/ads.py:1811`
**Severity:** CRITICAL

**Current code:**
```python
class UpdateBudgetRequest(BaseModel):
    daily_budget: float


@router.put("/{campaign_id}/budget")
async def update_campaign_budget(
    campaign_id: str,
    body: UpdateBudgetRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Update campaign daily budget. campaign_id can be local DB id or Meta campaign id."""
```

**Issue:** No authentication dependency — any anonymous caller can set any Meta campaign budget to any value, and the change propagates live to Meta Ads.

**Recommended fix:**
```python
@router.put("/{campaign_id}/budget")
async def update_campaign_budget(
    campaign_id: str,
    body: UpdateBudgetRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("admin", "operator", "super_admin")),
) -> dict:
    # + verify UserProject membership against campaign.project_id
```

### C2. `ads.py:638` — `GET /detail/{campaign_id}` unauthenticated with dangerous fallback
**File:** `backend/app/api/v1/ads.py:638`
**Severity:** CRITICAL

**Current code:**
```python
@router.get("/detail/{campaign_id}")
async def get_campaign_detail(
    campaign_id: str,
    project_slug: str | None = None,
    date_preset: str = "last_30d",
    db: AsyncSession = Depends(get_session),
) -> dict:
    ...
    else:
        proj_result = await db.execute(select(Project).limit(1))
        project = proj_result.scalar_one_or_none()
```

**Issue:** Endpoint is unauthenticated and, when no campaign or slug matches, silently falls back to the first Project in the DB, using that project's Meta token to fetch insights for any arbitrary Meta campaign ID.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
# and remove the `SELECT Project LIMIT 1` fallback — require a resolved campaign or explicit project_slug with membership check
```

### C3. `ads.py:1666` — `GET /{campaign_id}/logs` unauthenticated
**File:** `backend/app/api/v1/ads.py:1666`
**Severity:** CRITICAL

**Current code:**
```python
@router.get("/{campaign_id}/logs")
async def get_optimization_logs(
    campaign_id: int,
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Get optimization history for a campaign."""
    from app.models.optimization_log import CampaignOptimizationLog

    result = await db.execute(
```

**Issue:** Leaks the full optimizer decision history (CTR, spend, budget moves, Claude reasoning) for any campaign to anonymous callers.

**Recommended fix:**
```python
current_user=Depends(require_role("admin", "operator", "super_admin")),
# + verify caller has UserProject access to campaign.project_id
```

### C4. `ads.py:334` — `POST /{campaign_id}/refresh-creatives` unauthenticated
**File:** `backend/app/api/v1/ads.py:334`
**Severity:** CRITICAL

**Current code:**
```python
@router.post("/{campaign_id}/refresh-creatives")
async def refresh_creatives(
    campaign_id: int,
    body: RefreshCreativesRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate fresh Andromeda concepts that are conceptually opposite to fatigued hooks."""
    from app.services.claude.client import ClaudeClient
```

**Issue:** Anonymous callers can burn unlimited Claude credits and extract competitive-analysis output tied to any campaign.

**Recommended fix:**
```python
current_user=Depends(require_role("admin", "operator", "super_admin")),
# + UserProject membership check on campaign.project_id
```

### C5. `content.py:1047` — `POST /{content_id}/retry-facebook` unauthenticated
**File:** `backend/app/api/v1/content.py:1047`
**Severity:** CRITICAL

**Current code:**
```python
@router.post("/{content_id}/retry-facebook")
async def retry_facebook(
    content_id: int,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Retry publishing a post to Facebook only.

    Useful when a post was published to Instagram successfully but the Facebook
    page publish failed. Does not re-publish to Instagram.
```

**Issue:** No auth — anonymous caller can publish any ContentPost to Facebook using the project's Meta access token.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
# + UserProject check against post.project_id
```

## HIGH

### H1. `content.py:101` — `GET /list/{project_slug}` no auth guard
**File:** `backend/app/api/v1/content.py:101`
**Severity:** HIGH

**Current code:**
```python
@router.get("/list/{project_slug}")
async def list_content_by_slug(
    project_slug: str,
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: AsyncSession = Depends(get_session),
```

**Issue:** No auth — full content listing (including drafts and captions) leaks to anonymous callers for any slug.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
# + assert project membership
```

### H2. `content.py:197` — `POST /generate/{project_slug}` uses `get_current_user_optional`
**File:** `backend/app/api/v1/content.py:197`
**Severity:** HIGH

**Current code:**
```python
@router.post("/generate/{project_slug}")
async def generate_content(
    project_slug: str,
    body: AutoGenerateRequest = AutoGenerateRequest(),
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> dict:
```

**Issue:** Optional auth lets unauthenticated callers generate content, bypassing any token-limit/quota checks that depend on `current_user`.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
```

### H3. `content.py:1141` — `POST /batch/{project_slug}` no auth guard
**File:** `backend/app/api/v1/content.py:1141`
**Severity:** HIGH

**Current code:**
```python
@router.post("/batch/{project_slug}")
async def batch_generate_content(
    project_slug: str,
    body: BatchContentRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate multiple content posts for a batch plan."""
    result = await db.execute(select(Project).where(Project.slug == project_slug))
```

**Issue:** Anonymous can spawn large batches (multiplying Claude and S3 costs).

**Recommended fix:**
```python
current_user=Depends(get_current_user),
```

### H4. `content.py:1231` — `POST /{content_id}/generate-image` no auth guard (10 credits)
**File:** `backend/app/api/v1/content.py:1231`
**Severity:** HIGH

**Current code:**
```python
@router.post("/{content_id}/generate-image")
async def generate_image_for_post(
    content_id: int,
    body: GenerateImageRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate an AI image for a content post using the project's image provider.

    Deducts 10 credits. Returns the image URL and remaining credits.
```

**Issue:** Unauth caller drains 10 credits per call on any content post.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
# + IDOR check on post.project_id
```

### H5. `content.py:1308` — `POST /{content_id}/rerender-slide` no auth guard
**File:** `backend/app/api/v1/content.py:1308`
**Severity:** HIGH

**Current code:**
```python
@router.post("/{content_id}/rerender-slide")
async def rerender_slide(
    content_id: int,
    body: RerenderSlideRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Re-render a single carousel slide using the HTML renderer.
```

**Issue:** Anonymous can trigger Playwright render and S3 write for any post.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
# + IDOR check on post.project_id
```

### H6. `content.py:1397` — `POST /import-from-meta/{project_slug}` no auth guard
**File:** `backend/app/api/v1/content.py:1397`
**Severity:** HIGH

**Current code:**
```python
@router.post("/import-from-meta/{project_slug}")
async def import_from_meta(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Fetch previously published posts from Facebook Page and Instagram and insert them into the DB.
```

**Issue:** Anonymous can trigger a full Meta import for any project, producing rows and triggering Graph API quota burn.

**Recommended fix:**
```python
current_user=Depends(require_role("admin", "operator", "super_admin")),
```

### H7. `content.py:1542` — `POST /import/{project_slug}` no auth guard
**File:** `backend/app/api/v1/content.py:1542`
**Severity:** HIGH

**Current code:**
```python
@router.post("/import/{project_slug}")
async def import_instagram_posts(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Import published Instagram posts into the DB.

    Fetches media from the project's instagram_account_id via Meta Graph API.
```

**Issue:** Same issue as H6 for Instagram-only import.

**Recommended fix:**
```python
current_user=Depends(require_role("admin", "operator", "super_admin")),
```

### H8. `content.py:1655` — `POST /create-story/{project_slug}` no auth guard
**File:** `backend/app/api/v1/content.py:1655`
**Severity:** HIGH

**Current code:**
```python
@router.post("/create-story/{project_slug}")
async def create_instagram_story(
    project_slug: str,
    body: CreateStoryRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Publish an Instagram Story for a project.

    Creates a media container then publishes it via Meta Graph API.
```

**Issue:** Anonymous can publish Instagram Stories to any project's IG account.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
# + UserProject membership check
```

### H9. `content.py:1736` — `POST /{content_id}/generate-video` no auth guard (50 credits)
**File:** `backend/app/api/v1/content.py:1736`
**Severity:** HIGH

**Current code:**
```python
@router.post("/{content_id}/generate-video")
async def generate_video_for_post(
    content_id: int,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate a short-form video for a content post using the project's video provider.

    Deducts 50 credits. Returns the video URL and remaining credits.
    """
```

**Issue:** Anonymous caller can drain 50 credits per invocation on any post.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
# + IDOR check on post.project_id
```

### H10. `content.py:1801` — `POST /recommend-today/{project_slug}` no auth guard
**File:** `backend/app/api/v1/content.py:1801`
**Severity:** HIGH

**Current code:**
```python
@router.post("/recommend-today/{project_slug}")
async def recommend_today(
    project_slug: str,
    body: RecommendTodayRequest = RecommendTodayRequest(),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate a 'what to post today' recommendation using post history and competitor analysis."""
```

**Issue:** Anonymous Claude call; leaks the project's post-history analytics summary.

**Recommended fix:**
```python
current_user=Depends(get_current_user),
```

### H11. `content.py:946` — `POST /{content_id}/retry-instagram` authenticated but no IDOR check
**File:** `backend/app/api/v1/content.py:946`
**Severity:** HIGH

**Current code:**
```python
@router.post("/{content_id}/retry-instagram")
async def retry_instagram(
    content_id: int,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Retry publishing a post to Instagram only.

    Useful when a post was published to Facebook successfully but Instagram
```

**Issue:** Auth is present but no UserProject check — any authenticated user can re-publish posts belonging to projects they do not have access to. Same IDOR gap applies to lines 1231, 1308, 1736.

**Recommended fix:**
```python
post = ...  # fetch
await assert_project_access(current_user, post.project_id, db)
```

### H12. `content.py:186` — `GET /{project_id}` authenticated but no project IDOR check
**File:** `backend/app/api/v1/content.py:186`
**Severity:** HIGH

**Current code:**
```python
@router.get("/{project_id}", response_model=list[ContentPostResponse])
async def list_content(
    project_id: int,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> list[ContentPost]:
    """List content posts for a project."""
    result = await db.execute(
        select(ContentPost)
        .where(ContentPost.project_id == project_id)
```

**Issue:** Any authenticated user can enumerate project_id and list content for projects they don't own.

**Recommended fix:**
```python
await assert_project_access(current_user, project_id, db)
```

### H13. `ads.py:137` and `ads.py:183` — `/competitor-ads/{slug}` and `/adapt-competitor/{slug}` no membership check
**File:** `backend/app/api/v1/ads.py:137`, `backend/app/api/v1/ads.py:183`
**Severity:** HIGH

**Current code:**
```python
@router.get("/competitor-ads/{project_slug}")
async def get_competitor_ads(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("admin", "operator", "super_admin")),
) -> dict:
    """Fetch competitor ads (with Claude analysis) for a project using the Meta Ad Library."""
```

**Issue:** Role is gated but no UserProject membership — an operator assigned to project A can query competitor analysis for project B, using the caller's personal Meta token against any project slug.

**Recommended fix:**
```python
await assert_project_access(current_user, project.id, db)
```

### H14. `meta_oauth.py:31` — `ads_management` scope overly broad
**File:** `backend/app/api/v1/meta_oauth.py:31`
**Severity:** HIGH

**Current code:**
```python
_META_OAUTH_SCOPES = (
    "ads_management,"
    "ads_read,"
    "pages_read_engagement,"
    "pages_manage_posts,"
    "instagram_basic,"
    "instagram_content_publish,"
    "business_management"
)
```

**Issue:** Insights-only code paths only need `ads_read`; `ads_management` grants write to any ad account the user reaches, far beyond required scope.

**Recommended fix:**
```python
# Split scope sets — request ads_management only for flows that actually mutate
# For read-only insights clients, drop ads_management.
```

## MEDIUM

### M1. `pinterest.py:550` — kwarg mismatch silently breaks OAuth
**File:** `backend/app/api/v1/pinterest.py:550`
**Severity:** MEDIUM

**Current code:**
```python
    try:
        token_data = await exchange_code(
            code=code or "",
            verifier=code_verifier,
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=settings.PINTEREST_OAUTH_REDIRECT_URI,
        )
    except Exception as exc:
        logger.error("Pinterest OAuth token exchange error for project '%s': %s", project_slug, exc)
```

**Issue:** Calls `exchange_code(verifier=...)` but the service signature is `code_verifier=...` (see `services/pinterest_oauth.py:107`). TypeError is swallowed by the generic `except` and the user is redirected with a generic error — Pinterest OAuth is silently broken in production.

**Recommended fix:**
```python
token_data = await exchange_code(
    code=code or "",
    code_verifier=code_verifier,
    ...
)
```

### M2. `content.py:877` — naive-vs-aware datetime compare
**File:** `backend/app/api/v1/content.py:877`
**Severity:** MEDIUM

**Current code:**
```python
    if body.status == "approved" and previous_status != "approved":
        proj_result = await db.execute(select(Project).where(Project.id == post.project_id))
        project = proj_result.scalar_one_or_none()
        if project:
            # If scheduled_at is in the future, don't publish yet — scheduler will handle it
            if post.scheduled_at and post.scheduled_at > datetime.utcnow():
                # Just save approved status, scheduler will publish at the right time
                pass
            else:
                # Publish immediately (no schedule, or schedule is in the past)
                await _publish_post_to_meta(post, project, db)
```

**Issue:** Meta-imported posts write TZ-aware values to `scheduled_at` via `fromisoformat` (see M3), but this comparison uses naive `datetime.utcnow()`. TypeError is raised on compare, caught by upstream generic handler, and the post publishes immediately — bypassing the schedule gate.

**Recommended fix:**
```python
from datetime import timezone
now = datetime.now(timezone.utc)
scheduled = post.scheduled_at
if scheduled and scheduled.tzinfo is None:
    scheduled = scheduled.replace(tzinfo=timezone.utc)
if scheduled and scheduled > now:
    pass
```

### M3. `content.py:1470` and `content.py:1526` — TZ-aware written to naive column
**File:** `backend/app/api/v1/content.py:1470`, `backend/app/api/v1/content.py:1526`
**Severity:** MEDIUM

**Current code:**
```python
                published_at=published_at,
                scheduled_at=published_at,  # Use original Meta date so calendar places post correctly
                content={"source": "meta_import", "platform": "facebook", "permalink": fb_post.get("permalink_url")},
            )
            db.add(post)
            imported += 1
```

**Issue:** `published_at` comes from `datetime.fromisoformat(...)` on Meta's ISO-with-offset string → TZ-aware. The `scheduled_at` column is naive everywhere else. This is the root cause of M2.

**Recommended fix:**
```python
published_at = datetime.fromisoformat(meta_ts).astimezone(timezone.utc).replace(tzinfo=None)
```

### M4. `security.py:65` — naive-vs-aware for `expires_at`
**File:** `backend/app/core/security.py:65`
**Severity:** MEDIUM

**Current code:**
```python
        user_token = result.scalar_one_or_none()
        if user_token:
            # Check expiry — None means non-expiring
            if user_token.expires_at is not None and user_token.expires_at <= datetime.utcnow():
                logger.warning(
                    "get_project_token: Tier 2 token for user %s is expired (expires_at=%s) — skipping",
                    project.owner_id,
                    user_token.expires_at,
                )
```

**Issue:** Latent bug: if any code path writes TZ-aware values to `expires_at`, this compare raises; the except swallows and the token is treated as valid.

**Recommended fix:**
```python
expires = user_token.expires_at
if expires and expires.tzinfo is not None:
    expires = expires.astimezone(timezone.utc).replace(tzinfo=None)
if expires is not None and expires <= datetime.utcnow():
    ...
```

### M5. `auth.py:28` — deprecated `datetime.utcnow()` for JWT exp
**File:** `backend/app/api/v1/auth.py:28`
**Severity:** MEDIUM

**Current code:**
```python
def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "role": role, "exp": expire},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
```

**Issue:** Works (jose treats naive as UTC) but `datetime.utcnow()` is deprecated in Python 3.12 and inconsistent with the rest of the codebase migration path.

**Recommended fix:**
```python
expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
```

### M6. `meta_oauth.py:47` — JWT accepted via `?jwt=` query param
**File:** `backend/app/api/v1/meta_oauth.py:47`
**Severity:** MEDIUM

**Current code:**
```python
@router.get("/start")
async def meta_oauth_start(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    project_slug: str | None = None,
    mode: str = "project",
    jwt: str | None = Query(default=None),
) -> RedirectResponse:
```

**Issue:** JWT in query string lands in access logs, browser history, and Referer headers of any intermediate redirect.

**Recommended fix:**
```python
# Remove ?jwt=; require Authorization header or exchange for a short-lived
# opaque one-time token delivered as a httpOnly cookie before starting OAuth.
```

### M7. `meta_oauth.py:37` — `business_management` scope too broad
**File:** `backend/app/api/v1/meta_oauth.py:37`
**Severity:** MEDIUM

**Current code:**
```python
_META_OAUTH_SCOPES = (
    "ads_management,"
    "ads_read,"
    "pages_read_engagement,"
    "pages_manage_posts,"
    "instagram_basic,"
    "instagram_content_publish,"
    "business_management"
)
```

**Issue:** `business_management` grants write access to all Business Manager assets (pixels, catalogs, users). Not needed for page/IG/ads flows.

**Recommended fix:**
```python
# Drop business_management from the default scope set; request only when
# a flow actually needs to manage BM objects.
```

### M8. `ad_library.py:152,194,217` — Apify API key in `?token=` query param
**File:** `backend/app/services/meta/ad_library.py:152`, `:194`, `:217`
**Severity:** MEDIUM

**Current code:**
```python
        start_resp = await client.post(
            f"{APIFY_BASE_URL}/acts/{APIFY_ACTOR_ID}/runs",
            params={"token": api_key},
            json={
                "urls": [...],
                "count": limit,
            },
            timeout=30.0,
        )
```

**Issue:** Apify API key passed as query param — lands in Apify's access logs. Our side does not log it (loaded from `settings.APIFY_API_KEY`, never returned in responses), but any log leak on Apify's side exposes the credential.

**Recommended fix:**
```python
headers={"Authorization": f"Bearer {api_key}"}
# remove params={"token": ...}
```

## LOW

### L1. `content.py:906` — DELETE not atomic (SELECT → check → DELETE)
**File:** `backend/app/api/v1/content.py:906`
**Severity:** LOW

**Current code:**
```python
@router.delete("/posts/{post_id}")
async def delete_content_post(
    post_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Delete a content post.

    Not allowed if the post has already been published.
```

**Issue:** Status guard is a separate SELECT from the DELETE without `with_for_update()`. Low risk on SQLite (serialized writes). Upgrade-risk on Postgres.

**Recommended fix:**
```python
result = await db.execute(
    select(ContentPost).where(ContentPost.id == post_id).with_for_update()
)
```

### L2. `content.py:710,779,1020,1114,1718` — naive `published_at` writes
**File:** `backend/app/api/v1/content.py` (lines 710, 779, 1020, 1114, 1718)
**Severity:** LOW

**Current code:**
```python
        if at_least_one_success:
            post.status = "published"
            post.published_at = datetime.utcnow()
            if instagram_media_id:
                post.instagram_media_id = instagram_media_id
            if facebook_post_id:
                post.facebook_post_id = facebook_post_id
            await db.commit()
```

**Issue:** Naive `datetime.utcnow()` mixed with TZ-aware values from Meta import rows — inconsistent, future compare bugs.

**Recommended fix:**
```python
from datetime import timezone
post.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
```

### L3. `optimizer.py:284,307,523,671,720` — `utcnow()` vs `created_at`
**File:** `backend/app/services/ads/optimizer.py` (lines 284, 307, 523, 671, 720)
**Severity:** LOW

**Current code:**
```python
    # 2. Build prompt for Claude
    days_since_created = (datetime.utcnow() - campaign.created_at).days
```

**Issue:** Arithmetic against `campaign.created_at` is fragile if that column ever gets TZ-aware values.

**Recommended fix:**
```python
# Normalize both sides to naive UTC or both to aware UTC before subtracting.
```

### L4. `campaign_chat.py:148` — cooldown naive/aware risk
**File:** `backend/app/services/ads/campaign_chat.py:148`
**Severity:** LOW

**Current code:**
```python
    # 1. Check cooldown
    if user.last_chat_at is not None:
        elapsed = datetime.utcnow() - user.last_chat_at
        cooldown_total = timedelta(minutes=CHAT_COOLDOWN_MINUTES)
        if elapsed < cooldown_total:
            remaining = int((cooldown_total - elapsed).total_seconds())
            raise CooldownError(remaining)
```

**Issue:** Same naive/aware fragility as L3.

**Recommended fix:**
```python
# Normalize last_chat_at before subtraction; add a model-level validator.
```

### L5. `meta_oauth.py:44` — unauth OAuth start for `mode=project`
**File:** `backend/app/api/v1/meta_oauth.py:44`
**Severity:** LOW

**Current code:**
```python
@router.get("/start")
async def meta_oauth_start(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    project_slug: str | None = None,
    mode: str = "project",
    jwt: str | None = Query(default=None),
) -> RedirectResponse:
```

**Issue:** Anyone can initiate the Meta OAuth flow for any project. Mitigated by HMAC state, but not session-bound — an attacker could initiate the flow for a victim project and social-engineer the admin into completing it.

**Recommended fix:**
```python
# Bind state to the authenticated admin's session (include user_id in state payload
# and verify on callback).
```

### L6. `pinterest.py:45` — unused scopes
**File:** `backend/app/api/v1/pinterest.py:45`
**Severity:** LOW

**Current code:**
```python
_PINTEREST_OAUTH_SCOPES = "boards:read,pins:read,pins:write,user_accounts:read"
```

**Issue:** `pins:read` and `user_accounts:read` are requested but never used (grep shows no `GET /pins` or `/user_account` call).

**Recommended fix:**
```python
_PINTEREST_OAUTH_SCOPES = "boards:read,pins:write"
```

### L7. `meta_oauth.py:275-279` — base64 asset list in redirect URL
**File:** `backend/app/api/v1/meta_oauth.py:275`
**Severity:** LOW

**Current code:**
```python
        encoded = base64.urlsafe_b64encode(
            json.dumps(assets_payload).encode()
        ).decode()
        return RedirectResponse(
            url=f"{base_projects_url}?meta_select=true&slug={quote(slug)}&assets={quote(encoded)}",
            status_code=302,
        )
```

**Issue:** Encoded asset list lands in browser history and access logs. Data is not sensitive but avoidable.

**Recommended fix:**
```python
# Store assets in a short-lived server-side session keyed by a random id,
# put only the id in the redirect URL.
```

## Appendix: Fix priority order

1. **CRITICAL auth bypasses on money-moving endpoints** — C1 (`PUT /budget`), C5 (`retry-facebook`), C4 (`refresh-creatives`). Close these first; they either move live money or burn Claude credits for anonymous callers.
2. **CRITICAL read-side leaks** — C2 (`/detail` with LIMIT 1 fallback) and C3 (`/logs`). Remove the dangerous project fallback and add auth.
3. **HIGH auth gaps on content endpoints** — H1, H2, H3, H6, H7, H8, H10 (plus H4, H5, H9 for credit drain). Pattern: add `get_current_user` + UserProject membership dep.
4. **HIGH IDOR family** — H11, H12, H13. Introduce a shared `assert_project_access(user, project_id, db)` helper and call it in every content/ads endpoint.
5. **MEDIUM correctness bugs** — M1 (Pinterest OAuth silently broken), M2/M3 (naive/aware datetime causing premature publish). Fix M1 with the kwarg rename, then migrate `scheduled_at`/`published_at` to a consistent TZ handling.
6. **MEDIUM scope and credential hygiene** — H14, M7 (scope reduction), M6 (drop `?jwt=`), M8 (Apify key in Authorization header). Then sweep LOW naive-datetime items (L2, L3, L4) and the remaining OAuth UX items (L5, L6, L7).

## Appendix: False positives considered and dismissed

- `pinterest.py:484` — `generate_state` is HMAC-SHA256 signed with TTL and constant-time compare (verified at `services/pinterest_oauth.py:38-104`). **Not a vulnerability.**
- `competitor_ads.py` — file does not exist; competitor-ad logic lives in `ads.py` (covered under H13).
