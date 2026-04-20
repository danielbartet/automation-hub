"""Meta Ads campaign management — Graph API v19.0 via httpx."""
import httpx
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

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
                    "is_adset_budget_sharing_enabled": False,
                }
            )
            campaign_data = campaign_resp.json()
            if "error" in campaign_data:
                logger.error("Meta campaign creation error: %s", json.dumps(campaign_data["error"]))
                raise ValueError(f"Campaign creation failed: {campaign_data['error']['message']}")
            campaign_id = campaign_data.get("id")
            if not campaign_id:
                raise RuntimeError(f"Meta API returned no id: {campaign_data}")

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
                    "optimization_goal": "LINK_CLICKS" if "LEADS" in objective else "OFFSITE_CONVERSIONS" if "SALES" in objective else "LINK_CLICKS",
                    "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
                    "is_adset_budget_sharing_enabled": False,
                    "targeting": {
                        "geo_locations": {"countries": countries},
                    },
                    "status": "PAUSED",
                }
            )
            adset_data = adset_resp.json()
            if "error" in adset_data:
                err = adset_data["error"]
                raise ValueError(f"Ad set creation failed: {err.get('message')} | subcode={err.get('error_subcode')} | {err.get('error_user_msg')}")
            adset_id = adset_data.get("id")
            if not adset_id:
                raise RuntimeError(f"Meta API returned no id: {adset_data}")

            # 3. Create Ad Creative (use picture URL directly — no adimages upload needed)
            creative_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/adcreatives",
                params={"access_token": token},
                json={
                    "name": f"{name} \u2013 Creative",
                    "object_story_spec": {
                        "page_id": facebook_page_id,
                        "link_data": {
                            "picture": image_url,
                            "link": destination_url,
                            "message": ad_copy,
                            "call_to_action": {"type": "LEARN_MORE"},
                        }
                    }
                }
            )
            creative_data = creative_resp.json()
            if "error" in creative_data:
                err = creative_data["error"]
                logger.error("Meta creative creation error: %s", json.dumps(err))
                raise ValueError(
                    f"Creative creation failed: {err.get('message')} "
                    f"| code={err.get('code')} | subcode={err.get('error_subcode')} "
                    f"| user_msg={err.get('error_user_msg')}"
                )
            creative_id = creative_data.get("id")
            if not creative_id:
                raise RuntimeError(f"Meta API returned no id: {creative_data}")

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
                logger.error("Meta ad creation error: %s", json.dumps(ad_data["error"]))
                raise ValueError(f"Ad creation failed: {ad_data['error']['message']}")
            ad_id = ad_data.get("id")
            if not ad_id:
                raise RuntimeError(f"Meta API returned no id: {ad_data}")

        return {
            "campaign_id": campaign_id,
            "adset_id": adset_id,
            "creative_id": creative_id,
            "ad_id": ad_id,
        }

    async def create_creative_and_ad(
        self,
        client: httpx.AsyncClient,
        token: str,
        ad_account_id: str,
        facebook_page_id: str,
        adset_id: str,
        campaign_name: str,
        concept_id: int,
        hook_3s: str,
        body: str,
        cta: str,
        image_url: str,
        destination_url: str,
    ) -> dict:
        """Create an Ad Creative and Ad for a single concept under an existing Ad Set."""
        # Map CTA string to Meta enum
        cta_map = {
            "Learn More": "LEARN_MORE",
            "Sign Up": "SIGN_UP",
            "Shop Now": "SHOP_NOW",
            "Contact Us": "CONTACT_US",
        }
        cta_type = cta_map.get(cta, "LEARN_MORE")

        # Create Ad Creative using picture URL directly (avoids adimages permission requirement)
        creative_resp = await client.post(
            f"{META_BASE}/act_{ad_account_id}/adcreatives",
            params={"access_token": token},
            json={
                "name": f"{campaign_name} – Creative {concept_id}",
                "object_story_spec": {
                    "page_id": facebook_page_id,
                    "link_data": {
                        "picture": image_url,
                        "link": destination_url,
                        "message": body,
                        "name": hook_3s,
                        "call_to_action": {"type": cta_type},
                    },
                },
            },
        )
        creative_data = creative_resp.json()
        if "error" in creative_data:
            err = creative_data["error"]
            logger.error("Meta creative error concept %s: %s", concept_id, json.dumps(err))
            raise ValueError(
                f"Creative creation failed for concept {concept_id}: {err.get('message')} "
                f"| code={err.get('code')} | subcode={err.get('error_subcode')} "
                f"| user_msg={err.get('error_user_msg')} | type={err.get('type')}"
            )
        creative_id = creative_data.get("id")
        if not creative_id:
            raise RuntimeError(f"Meta API returned no id: {creative_data}")

        # Create Ad
        ad_resp = await client.post(
            f"{META_BASE}/act_{ad_account_id}/ads",
            params={"access_token": token},
            json={
                "name": f"{campaign_name} – Ad {concept_id}",
                "adset_id": adset_id,
                "creative": {"creative_id": creative_id},
                "status": "PAUSED",
            },
        )
        ad_data = ad_resp.json()
        if "error" in ad_data:
            logger.error("Meta ad error concept %s: %s", concept_id, json.dumps(ad_data["error"]))
            raise ValueError(f"Ad creation failed for concept {concept_id}: {ad_data['error']['message']}")
        ad_id = ad_data.get("id")
        if not ad_id:
            raise RuntimeError(f"Meta API returned no id: {ad_data}")

        return {"creative_id": creative_id, "ad_id": ad_id}

    def _build_placement_targeting(
        self,
        placements: list[str],
        advantage_placements: bool,
    ) -> dict:
        """Build publisher_platforms and position targeting from placement list."""
        if advantage_placements or not placements:
            return {
                "publisher_platforms": ["facebook", "instagram", "audience_network"],
                "facebook_positions": ["feed", "right_hand_column", "marketplace"],
                "instagram_positions": ["stream", "reels", "story", "explore"],
            }

        placement_map = {
            "instagram_feed": ("instagram", "stream"),
            "instagram_reels": ("instagram", "reels"),
            "instagram_stories": ("instagram", "story"),
            "facebook_feed": ("facebook", "feed"),
            "audience_network": ("audience_network", "classic"),
        }

        publishers: dict[str, list[str]] = {}
        for p in placements:
            if p not in placement_map:
                continue
            platform, position = placement_map[p]
            publishers.setdefault(platform, []).append(position)

        result: dict = {}
        if publishers:
            result["publisher_platforms"] = list(publishers.keys())
            if "facebook" in publishers:
                result["facebook_positions"] = publishers["facebook"]
            if "instagram" in publishers:
                result["instagram_positions"] = publishers["instagram"]
            if "audience_network" in publishers:
                result["audience_network_positions"] = publishers["audience_network"]
        return result

    async def _create_adset(
        self,
        client: httpx.AsyncClient,
        token: str,
        ad_account_id: str,
        campaign_id: str,
        name: str,
        daily_budget_cents: int,
        opt_goal: str,
        targeting: dict,
        promoted_object: dict | None = None,
    ) -> str:
        """Create a single ad set and return its ID."""
        payload: dict = {
            "name": name,
            "campaign_id": campaign_id,
            "daily_budget": daily_budget_cents,
            "billing_event": "IMPRESSIONS",
            "optimization_goal": opt_goal,
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
            "is_adset_budget_sharing_enabled": False,
            "targeting": targeting,
            "status": "PAUSED",
        }
        if promoted_object:
            payload["promoted_object"] = promoted_object

        adset_resp = await client.post(
            f"{META_BASE}/act_{ad_account_id}/adsets",
            params={"access_token": token},
            json=payload,
        )
        adset_data = adset_resp.json()
        if "error" in adset_data:
            err = adset_data["error"]
            raise ValueError(f"Ad set creation failed: {err.get('message')} | subcode={err.get('error_subcode')} | {err.get('error_user_msg')}")
        new_id = adset_data.get("id")
        if not new_id:
            raise RuntimeError(f"Meta API returned no id: {adset_data}")
        return new_id

    async def create_campaign_with_concepts(
        self,
        token: str,
        ad_account_id: str,
        facebook_page_id: str,
        name: str,
        objective: str,
        daily_budget_dollars: float,
        countries: list[str],
        destination_url: str,
        concepts: list[dict],
        placeholder_image_fn,  # async callable(project_slug) -> str
        project_slug: str,
        audience_type: str = "broad",
        custom_audience_ids: list[str] | None = None,
        lookalike_audience_ids: list[str] | None = None,
        placements: list[str] | None = None,
        advantage_placements: bool = True,
        pixel_event: str | None = None,
        pixel_id: str | None = None,
    ) -> dict:
        """Create Campaign + Ad Set(s) + multiple Creatives/Ads from concepts. All start PAUSED."""
        custom_audience_ids = custom_audience_ids or []
        lookalike_audience_ids = lookalike_audience_ids or []
        placements = placements or []

        async with httpx.AsyncClient(timeout=30.0) as client:
            # 1. Create Campaign
            campaign_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/campaigns",
                params={"access_token": token},
                json={
                    "name": name,
                    "objective": objective,
                    "status": "PAUSED",
                    "special_ad_categories": [],
                    "is_adset_budget_sharing_enabled": False,
                },
            )
            campaign_data = campaign_resp.json()
            if "error" in campaign_data:
                logger.error("Meta campaign creation error: %s", json.dumps(campaign_data["error"]))
                raise ValueError(f"Campaign creation failed: {campaign_data['error']['message']}")
            campaign_id = campaign_data.get("id")
            if not campaign_id:
                raise RuntimeError(f"Meta API returned no id: {campaign_data}")

            # 2. Determine optimization goal
            daily_budget_cents = int(daily_budget_dollars * 100)

            # Determine optimization goal and promoted_object based on objective
            SALES_EVENTS = {"PURCHASE", "ADD_TO_CART", "INITIATED_CHECKOUT", "ADD_PAYMENT_INFO", "CONTENT_VIEW"}
            promoted_object: dict | None = None
            if "SALES" in objective and pixel_event and pixel_id and pixel_event.upper() in SALES_EVENTS:
                opt_goal = "OFFSITE_CONVERSIONS"
                promoted_object = {
                    "pixel_id": pixel_id,
                    "custom_event_type": pixel_event.upper(),
                }
            elif "AWARENESS" in objective:
                opt_goal = "REACH"
            else:
                opt_goal = "LINK_CLICKS"

            # 3. Build placement targeting
            placement_targeting = self._build_placement_targeting(placements, advantage_placements)

            # 4. Create Ad Set(s) based on audience_type
            adset_id: str
            extra_adset_id: str | None = None

            if audience_type == "custom":
                targeting = {
                    "custom_audiences": [{"id": aid} for aid in custom_audience_ids],
                    "geo_locations": {"countries": countries},
                    **placement_targeting,
                }
                adset_id = await self._create_adset(
                    client, token, ad_account_id, campaign_id,
                    name=f"{name} \u2013 Ad Set",
                    daily_budget_cents=daily_budget_cents,
                    opt_goal=opt_goal,
                    targeting=targeting,
                    promoted_object=promoted_object,
                )

            elif audience_type == "lookalike":
                targeting = {
                    "custom_audiences": [{"id": aid} for aid in lookalike_audience_ids],
                    "geo_locations": {"countries": countries},
                    "age_min": 18,
                    "age_max": 65,
                    **placement_targeting,
                }
                adset_id = await self._create_adset(
                    client, token, ad_account_id, campaign_id,
                    name=f"{name} \u2013 Ad Set",
                    daily_budget_cents=daily_budget_cents,
                    opt_goal=opt_goal,
                    targeting=targeting,
                    promoted_object=promoted_object,
                )

            elif audience_type == "retargeting_lookalike":
                # Split budget evenly between the two ad sets
                half_budget_cents = daily_budget_cents // 2

                retargeting_targeting = {
                    "custom_audiences": [{"id": aid} for aid in custom_audience_ids],
                    "geo_locations": {"countries": countries},
                    **placement_targeting,
                }
                adset_id = await self._create_adset(
                    client, token, ad_account_id, campaign_id,
                    name=f"{name} \u2013 Retargeting",
                    daily_budget_cents=half_budget_cents,
                    opt_goal=opt_goal,
                    targeting=retargeting_targeting,
                    promoted_object=promoted_object,
                )

                lookalike_targeting = {
                    "custom_audiences": [{"id": aid} for aid in lookalike_audience_ids],
                    "geo_locations": {"countries": countries},
                    "age_min": 18,
                    "age_max": 65,
                    **placement_targeting,
                }
                extra_adset_id = await self._create_adset(
                    client, token, ad_account_id, campaign_id,
                    name=f"{name} \u2013 Lookalike",
                    daily_budget_cents=half_budget_cents,
                    opt_goal=opt_goal,
                    targeting=lookalike_targeting,
                    promoted_object=promoted_object,
                )

            else:
                # broad (default)
                targeting = {
                    "geo_locations": {"countries": countries},
                    "age_min": 18,
                    "age_max": 65,
                    **placement_targeting,
                }
                adset_id = await self._create_adset(
                    client, token, ad_account_id, campaign_id,
                    name=f"{name} \u2013 Ad Set",
                    daily_budget_cents=daily_budget_cents,
                    opt_goal=opt_goal,
                    targeting=targeting,
                    promoted_object=promoted_object,
                )

            # 5. Create Creative + Ad for each concept under each ad set
            ads_created = []
            first_creative_id = None
            first_ad_id = None

            adset_ids = [adset_id]
            if extra_adset_id:
                adset_ids.append(extra_adset_id)

            for current_adset_id in adset_ids:
                for concept in concepts:
                    concept_id = concept.get("id", 0)
                    hook_3s = concept.get("hook_3s", "")
                    body_text = concept.get("body", "")
                    cta = concept.get("cta", "Learn More")
                    image_url = concept.get("image_url") or await placeholder_image_fn(project_slug)

                    result = await self.create_creative_and_ad(
                        client=client,
                        token=token,
                        ad_account_id=ad_account_id,
                        facebook_page_id=facebook_page_id,
                        adset_id=current_adset_id,
                        campaign_name=name,
                        concept_id=concept_id,
                        hook_3s=hook_3s,
                        body=body_text,
                        cta=cta,
                        image_url=image_url,
                        destination_url=destination_url,
                    )
                    ads_created.append(result)
                    if first_creative_id is None:
                        first_creative_id = result["creative_id"]
                        first_ad_id = result["ad_id"]

        return {
            "campaign_id": campaign_id,
            "adset_id": adset_id,
            "extra_adset_id": extra_adset_id,
            "creative_id": first_creative_id,
            "ad_id": first_ad_id,
            "ads_created": ads_created,
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

    async def update_campaign_budget(self, token: str, campaign_id: str, new_daily_budget_dollars: float) -> bool:
        """Update campaign-level daily budget (used when no adset_id is available)."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{META_BASE}/{campaign_id}",
                params={"access_token": token},
                json={"daily_budget": int(new_daily_budget_dollars * 100)}
            )
            return "success" in resp.json()

    async def fetch_effective_status(self, token: str, campaign_id: str) -> str | None:
        """Return the effective_status for a single campaign (reflects budget/schedule state)."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{META_BASE}/{campaign_id}",
                params={
                    "fields": "id,effective_status",
                    "access_token": token,
                },
            )
            data = resp.json()
            if "error" in data:
                logger.warning("fetch_effective_status error for %s: %s", campaign_id, data["error"])
                return None
            return data.get("effective_status")

    async def fetch_campaign_insights(
        self,
        token: str,
        campaign_id: str,
        date_preset: str = "last_7d",
        time_range: dict | None = None,
    ) -> dict:
        """Fetch campaign metrics for optimization analysis.

        Pass ``time_range`` ({"since": "YYYY-MM-DD", "until": "YYYY-MM-DD"}) to
        override ``date_preset`` with an explicit date window.
        """
        params: dict = {
            "fields": "spend,impressions,reach,clicks,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type,purchase_roas",
            # Explicitly request only 7d_click + 1d_view attribution windows so that
            # purchase counts match the Meta Ads Manager default attribution setting.
            # Without this param, Meta returns all applicable windows combined, which
            # can inflate conversion counts vs. what Ads Manager shows.
            "action_attribution_windows": json.dumps(["7d_click", "1d_view"]),
            "access_token": token,
        }
        if time_range:
            params["time_range"] = json.dumps(time_range)
        else:
            params["date_preset"] = date_preset

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{META_BASE}/{campaign_id}/insights",
                params=params,
            )
            data = resp.json()
            rows = data.get("data", [])
            return rows[0] if rows else {}
