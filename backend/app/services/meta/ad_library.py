import httpx
from datetime import datetime, timezone


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
                            "body": bodies[0] if bodies else "",
                            "title": titles[0] if titles else "",
                            "days_active": days_active,
                            "platforms": ad.get("publisher_platforms", []),
                            "snapshot_url": ad.get("ad_snapshot_url", "")
                        })
            except Exception:
                # Skip silently on any error for this competitor
                continue

        all_ads.sort(key=lambda x: x["days_active"], reverse=True)
        return all_ads[:20]

    def _days_since(self, date_str: str) -> int:
        if not date_str:
            return 0
        try:
            start = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            return (now - start).days
        except Exception:
            return 0
