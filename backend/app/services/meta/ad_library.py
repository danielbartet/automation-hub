import httpx
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select


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
            except Exception:
                # Skip silently on any error for this competitor
                continue

        all_ads.sort(key=lambda x: x["days_active"], reverse=True)
        return all_ads[:20]

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
    ) -> list[dict]:
        """
        Returns competitor ads for a project, using a 48-hour cache stored in
        competitor_research_cache. Fetches fresh data if the cache is stale or missing.
        Runs Claude analysis on the ads and persists results to analysis_json.
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

        if cache and cache.fetched_at > cutoff:
            ads = cache.research_json.get("ads", [])
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
        ads = await self.get_competitor_ads(access_token=access_token, competitors=competitors_list)

        # Upsert cache (without analysis yet)
        now = datetime.now(timezone.utc)
        if cache:
            cache.research_json = {"ads": ads}
            cache.analysis_json = None
            cache.fetched_at = now
        else:
            cache = CompetitorResearchCache(
                project_id=project.id,
                research_json={"ads": ads},
                analysis_json=None,
                fetched_at=now,
            )
            db.add(cache)
        await db.commit()

        # Run analysis
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

    def _days_since(self, date_str: str) -> int:
        if not date_str:
            return 0
        try:
            start = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            return (now - start).days
        except Exception:
            return 0
