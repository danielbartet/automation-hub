import asyncio
import httpx
import logging
import os
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

logger = logging.getLogger(__name__)

APIFY_BASE_URL = "https://api.apify.com/v2"
APIFY_ACTOR_ID = "curious_coder~facebook-ads-library-scraper"


class MetaAdLibraryService:
    BASE_URL = "https://graph.facebook.com/v19.0/ads_archive"

    async def get_competitor_ads(
        self,
        access_token: str,
        competitors: list[str],
        countries: list[str] = None,
        limit: int = 10
    ) -> list[dict]:
        """
        Fetches active ads from Meta Ad Library for competitor page names/handles.
        NOTE: Meta Ad Library API only returns political ads. For commercial ads use
        get_competitor_ads_apify() instead.
        Returns structured ad data sorted by days_active (proxy for performance).
        """
        if countries is None:
            countries = ["AR", "MX", "CO", "CL"]

        all_ads = []

        for competitor in competitors:
            page_name = competitor.replace("@", "").strip()
            if not page_name:
                continue
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get(
                        self.BASE_URL,
                        params={
                            "search_terms": page_name,
                            "ad_reached_countries": ",".join(countries),
                            "ad_active_status": "ACTIVE",
                            "fields": ",".join([
                                "id",
                                "page_name",
                                "ad_creative_bodies",
                                "ad_creative_link_titles",
                                "ad_delivery_start_time",
                                "ad_snapshot_url",
                                "publisher_platforms",
                                "languages"
                            ]),
                            "limit": limit,
                            "access_token": access_token
                        },
                        timeout=15.0
                    )
                if response.status_code == 200:
                    data = response.json()
                    if "error" in data:
                        logger.warning("Ad Library API error for '%s': %s", page_name, data["error"])
                        continue
                    ads = data.get("data", [])
                    for ad in ads:
                        start = ad.get("ad_delivery_start_time", "")
                        days_active = self._days_since(start)
                        # ad_creative_bodies is a list; take first if available
                        bodies = ad.get("ad_creative_bodies", [])
                        titles = ad.get("ad_creative_link_titles", [])
                        all_ads.append({
                            "competitor": page_name,
                            "page_name": ad.get("page_name", page_name),
                            "body": bodies[0] if bodies else "",
                            "title": titles[0] if titles else "",
                            "ad_creative_bodies": bodies,
                            "days_active": days_active,
                            "platforms": ad.get("publisher_platforms", []),
                            "snapshot_url": ad.get("ad_snapshot_url", "")
                        })
            except Exception as e:
                logger.warning("Ad Library fetch failed for competitor '%s': %s", page_name, e)
                continue

        all_ads.sort(key=lambda x: x["days_active"], reverse=True)
        return all_ads[:20]

    async def get_competitor_ads_apify(
        self,
        competitors: list[str],
        limit: int = 10,
        timeout: int = 60,
    ) -> list[dict]:
        """
        Fetches commercial competitor ads via Apify's Facebook Ad Library scraper.
        Uses actor: curious_coder/facebook-ad-library-scraper

        Falls back to empty list on any error — never raises.
        """
        api_key = os.environ.get("APIFY_API_KEY", "")
        if not api_key:
            from app.core.config import settings
            api_key = settings.APIFY_API_KEY

        if not api_key:
            logger.warning("APIFY_API_KEY not set — skipping Apify competitor fetch")
            return []

        logger.info("Fetching competitor ads via Apify for: %s", competitors)

        all_ads: list[dict] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            for competitor in competitors:
                page_name = competitor.replace("@", "").strip()
                if not page_name:
                    continue

                try:
                    ads = await self._apify_fetch_one(
                        client=client,
                        api_key=api_key,
                        competitor=page_name,
                        limit=limit,
                        timeout=timeout,
                    )
                    all_ads.extend(ads)
                except Exception as e:
                    logger.warning("Apify fetch failed for competitor '%s': %s", page_name, e)
                    continue

        all_ads.sort(key=lambda x: x["days_active"], reverse=True)
        return all_ads[:20]

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
                "urls": [
                    {"url": f"https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q={competitor}&search_type=keyword_unordered&media_type=all"}
                ],
                "count": limit,
            },
            timeout=30.0,
        )

        if start_resp.status_code not in (200, 201):
            logger.warning(
                "Apify actor start failed for '%s': HTTP %s — %s",
                competitor, start_resp.status_code, start_resp.text[:300],
            )
            return []

        run_data = start_resp.json()
        run_id = run_data.get("data", {}).get("id")
        if not run_id:
            logger.warning("Apify actor start returned no run ID for '%s': %s", competitor, run_data)
            return []

        logger.info("Apify run started for '%s': run_id=%s", competitor, run_id)

        # Poll for completion
        deadline = asyncio.get_event_loop().time() + timeout
        poll_interval = 3

        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                logger.warning(
                    "Apify run timed out after %ss for competitor '%s' (run_id=%s)",
                    timeout, competitor, run_id,
                )
                return []

            await asyncio.sleep(poll_interval)

            status_resp = await client.get(
                f"{APIFY_BASE_URL}/actor-runs/{run_id}",
                params={"token": api_key},
                timeout=15.0,
            )
            if status_resp.status_code != 200:
                logger.warning("Apify status check failed: HTTP %s", status_resp.status_code)
                continue

            status_data = status_resp.json().get("data", {})
            run_status = status_data.get("status", "")

            if run_status == "SUCCEEDED":
                break
            elif run_status in ("FAILED", "ABORTED", "TIMED-OUT"):
                logger.warning(
                    "Apify run ended with status '%s' for competitor '%s' (run_id=%s)",
                    run_status, competitor, run_id,
                )
                return []
            # RUNNING or READY — keep polling

        # Fetch dataset items
        dataset_resp = await client.get(
            f"{APIFY_BASE_URL}/actor-runs/{run_id}/dataset/items",
            params={"token": api_key},
            timeout=30.0,
        )
        if dataset_resp.status_code != 200:
            logger.warning(
                "Apify dataset fetch failed for '%s': HTTP %s",
                competitor, dataset_resp.status_code,
            )
            return []

        items = dataset_resp.json()
        if not isinstance(items, list):
            # Some actors return {"items": [...]}
            items = items.get("items", []) if isinstance(items, dict) else []

        logger.info("Apify returned %d items for competitor '%s'", len(items), competitor)
        if items and isinstance(items[0], dict):
            logger.info("Apify first item keys for '%s': %s", competitor, list(items[0].keys()))
            logger.info("Apify first item sample for '%s': %s", competitor, str(items[0])[:800])
        return [self._map_apify_item(item, competitor) for item in items if isinstance(item, dict)]

    def _map_apify_item(self, item: dict, competitor: str) -> dict:
        """Map an Apify Facebook Ad Library item to our standard ad shape.

        The curious_coder/facebook-ads-library-scraper actor returns:
          adArchiveID, pageName, pageID, startDate (Unix int), endDate,
          isActive, publisherPlatform (list), snapshot (dict with title/body/cta_text/images/link_url),
          collationCount
        """
        # page_name
        page_name = item.get("pageName") or item.get("page_name") or competitor

        # body — extract from nested snapshot.body.markup.__html first
        snapshot = item.get("snapshot") or {}
        body = ""
        raw_body = snapshot.get("body")
        if isinstance(raw_body, dict):
            body = raw_body.get("markup", {}).get("__html", "") or ""
        elif isinstance(raw_body, str):
            body = raw_body
        if not body:
            bodies_fallback = item.get("ad_creative_bodies") or []
            if isinstance(bodies_fallback, str):
                bodies_fallback = [bodies_fallback]
            body = bodies_fallback[0] if bodies_fallback else ""

        # title — from snapshot.title or ad_creative_link_titles
        title = snapshot.get("title", "") or ""
        if not title:
            titles_fallback = item.get("ad_creative_link_titles") or []
            if isinstance(titles_fallback, str):
                titles_fallback = [titles_fallback]
            if isinstance(titles_fallback, list) and titles_fallback:
                title = titles_fallback[0]

        # platforms — actor uses publisherPlatform (list)
        platforms = item.get("publisherPlatform") or item.get("publisher_platforms") or []
        if isinstance(platforms, str):
            platforms = [platforms]

        # snapshot_url
        snapshot_url = (
            item.get("ad_snapshot_url")
            or item.get("snapshot_url")
            or snapshot.get("link_url")
            or ""
        )

        # days_active — startDate is a Unix timestamp integer
        start_time = item.get("startDate") or item.get("ad_delivery_start_time") or item.get("start_date") or ""

        # bodies list for ad_creative_bodies field
        bodies = [body] if body else []

        return {
            "competitor": competitor,
            "page_name": page_name,
            "body": body,
            "title": title,
            "ad_creative_bodies": bodies,
            "days_active": self._days_since(start_time),
            "platforms": platforms,
            "snapshot_url": snapshot_url,
        }

    def _merge_analysis(self, ads: list[dict], analyses: list[dict]) -> list[dict]:
        """Inject analysis into each ad dict, matching by analysis['index']."""
        index_map = {item["index"]: item for item in analyses if isinstance(item, dict) and "index" in item}
        result = []
        for i, ad in enumerate(ads):
            analysis = index_map.get(i)
            if analysis is None and i < len(analyses):
                analysis = analyses[i]
            merged = dict(ad)
            if analysis is not None:
                merged["analysis"] = analysis
            result.append(merged)
        return result

    async def get_competitor_ads_cached(
        self,
        db: AsyncSession,
        project,
        access_token: str,
        use_claude_fallback: bool = False,
    ) -> list[dict]:
        """
        Returns competitor ads for a project, using a 48-hour cache stored in
        competitor_research_cache. Fetches fresh data if the cache is stale or missing.

        Priority:
          1. Apify (if APIFY_API_KEY is set) — works for commercial ads
          2. Meta Ad Library API (fallback — only returns political ads, usually empty)
          3. Claude synthetic research (if use_claude_fallback=True and still empty)
        """
        from app.models.competitor_cache import CompetitorResearchCache

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
            ads = cache.research_json.get("ads", [])
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

        # Fetch fresh data
        config = project.content_config or {}
        competitors_raw = config.get("competitors", "")
        if not competitors_raw:
            return []

        competitors_list = [
            c.strip().lstrip("@")
            for c in competitors_raw.replace("\n", ",").split(",")
            if c.strip()
        ]

        # Determine fetch strategy: Apify preferred over Meta Ad Library
        from app.core.config import settings
        apify_key = settings.APIFY_API_KEY

        if apify_key:
            logger.info("Using Apify to fetch competitor ads (APIFY_API_KEY is set)")
            ads = await self.get_competitor_ads_apify(competitors=competitors_list)
        else:
            logger.info("Using Meta Ad Library API to fetch competitor ads (no APIFY_API_KEY)")
            ads = await self.get_competitor_ads(access_token=access_token, competitors=competitors_list)

        # If still empty — fall back to Claude synthetic research
        is_synthetic = False
        if not ads and competitors_list and use_claude_fallback:
            try:
                from app.services.claude.client import ClaudeClient
                ads = await ClaudeClient().research_competitors_by_name(
                    competitors=competitors_list,
                    brand_config=config,
                )
                if ads:
                    is_synthetic = True
            except Exception as e:
                logger.warning("Claude competitor fallback failed: %s", e)

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

        # If synthetic, analysis is already embedded — extract and store
        if is_synthetic:
            analyses = [ad.get("analysis") for ad in ads if ad.get("analysis")]
            cache.analysis_json = analyses
            await db.commit()
            return self._merge_analysis(ads, analyses)

        # Run analysis on real ads
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

    def _days_since(self, date_val) -> int:
        if not date_val:
            return 0
        try:
            if isinstance(date_val, (int, float)):
                start = datetime.fromtimestamp(date_val, tz=timezone.utc)
            else:
                start = datetime.fromisoformat(str(date_val).replace("Z", "+00:00"))
            return (datetime.now(timezone.utc) - start).days
        except Exception:
            return 0
