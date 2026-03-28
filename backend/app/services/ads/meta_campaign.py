"""Meta Ads campaign management — Graph API v19.0 via httpx."""
import httpx
import json
from typing import Optional

META_BASE = "https://graph.facebook.com/v19.0"


class MetaCampaignService:

    async def create_full_campaign(
        self,
        token: str,
        ad_account_id: str,
        facebook_page_id: str,
        name: str,
        objective: str,  # OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC
        daily_budget_dollars: float,
        countries: list[str],
        image_url: str,
        ad_copy: str,
        destination_url: str,
    ) -> dict:
        """Creates Campaign -> Ad Set -> Ad Creative -> Ad. All start PAUSED."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1. Create Campaign
            campaign_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/campaigns",
                params={"access_token": token},
                json={
                    "name": name,
                    "objective": objective,
                    "status": "PAUSED",
                    "special_ad_categories": [],
                }
            )
            campaign_data = campaign_resp.json()
            if "error" in campaign_data:
                raise ValueError(f"Campaign creation failed: {campaign_data['error']['message']}")
            campaign_id = campaign_data["id"]

            # 2. Create Ad Set (Broad/Andromeda targeting)
            daily_budget_cents = int(daily_budget_dollars * 100)
            adset_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/adsets",
                params={"access_token": token},
                json={
                    "name": f"{name} \u2013 Ad Set",
                    "campaign_id": campaign_id,
                    "daily_budget": daily_budget_cents,
                    "billing_event": "IMPRESSIONS",
                    "optimization_goal": "LEAD_GENERATION" if "LEADS" in objective else "OFFSITE_CONVERSIONS" if "SALES" in objective else "LINK_CLICKS",
                    "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
                    "targeting": {
                        "geo_locations": {"countries": countries},
                    },
                    "status": "PAUSED",
                }
            )
            adset_data = adset_resp.json()
            if "error" in adset_data:
                raise ValueError(f"Ad set creation failed: {adset_data['error']['message']}")
            adset_id = adset_data["id"]

            # 3. Upload image to get hash
            image_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/adimages",
                params={"access_token": token},
                json={"url": image_url}
            )
            image_data = image_resp.json()
            # image hash is nested under images > url > hash
            images_dict = image_data.get("images", {})
            image_hash = None
            for _url, img_info in images_dict.items():
                image_hash = img_info.get("hash")
                break
            if not image_hash:
                raise ValueError(f"Image upload failed: {image_data}")

            # 4. Create Ad Creative
            creative_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/adcreatives",
                params={"access_token": token},
                json={
                    "name": f"{name} \u2013 Creative",
                    "object_story_spec": {
                        "page_id": facebook_page_id,
                        "link_data": {
                            "image_hash": image_hash,
                            "link": destination_url,
                            "message": ad_copy,
                            "call_to_action": {"type": "LEARN_MORE"},
                        }
                    }
                }
            )
            creative_data = creative_resp.json()
            if "error" in creative_data:
                raise ValueError(f"Creative creation failed: {creative_data['error']['message']}")
            creative_id = creative_data["id"]

            # 5. Create Ad
            ad_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/ads",
                params={"access_token": token},
                json={
                    "name": f"{name} \u2013 Ad",
                    "adset_id": adset_id,
                    "creative": {"creative_id": creative_id},
                    "status": "PAUSED",
                }
            )
            ad_data = ad_resp.json()
            if "error" in ad_data:
                raise ValueError(f"Ad creation failed: {ad_data['error']['message']}")
            ad_id = ad_data["id"]

        return {
            "campaign_id": campaign_id,
            "adset_id": adset_id,
            "creative_id": creative_id,
            "ad_id": ad_id,
        }

    async def set_campaign_status(self, token: str, campaign_id: str, status: str) -> bool:
        """Set campaign status: ACTIVE or PAUSED."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{META_BASE}/{campaign_id}",
                params={"access_token": token},
                json={"status": status}
            )
            return "success" in resp.json()

    async def update_adset_budget(self, token: str, adset_id: str, new_daily_budget_dollars: float) -> bool:
        """Update ad set daily budget."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{META_BASE}/{adset_id}",
                params={"access_token": token},
                json={"daily_budget": int(new_daily_budget_dollars * 100)}
            )
            return "success" in resp.json()

    async def fetch_campaign_insights(self, token: str, campaign_id: str, date_preset: str = "last_7d") -> dict:
        """Fetch campaign metrics for optimization analysis."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{META_BASE}/{campaign_id}/insights",
                params={
                    "fields": "spend,impressions,reach,clicks,ctr,cpm,cpc,frequency,actions,cost_per_action_type",
                    "date_preset": date_preset,
                    "access_token": token,
                }
            )
            data = resp.json()
            rows = data.get("data", [])
            return rows[0] if rows else {}
