---
name: meta-ads-api
description: "ALWAYS use this skill for ANY Meta Ads campaign management task. Load it whenever: creating campaigns, managing ad sets, uploading creatives, reading campaign metrics, pausing or scaling ads, or any Marketing API operation. Use facebook-business SDK — never raw HTTP requests for ads operations. IMPORTANT: Use unified Advantage+ structure — legacy ASC/AAC APIs deprecated Q1 2026."
---

# Meta Ads API Skill

## SDK: facebook-python-business-sdk (official)
Install: add facebook_business to pyproject.toml

## Authentication
```python
from facebook_business.api import FacebookAdsApi

def get_meta_api(access_token: str):
    api = FacebookAdsApi.init(access_token=access_token, api_version="v19.0")
    return api
```

## Campaign structure (Meta hierarchy)
```
Ad Account
└── Campaign (objective: OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_TRAFFIC)
    └── Ad Set (budget, schedule, targeting: BROAD/Advantage+)
        └── Ad (references an Ad Creative)
            └── Ad Creative (image_hash or video_id + copy + link)
```

## Create Campaign (Advantage+ / Broad — Andromeda-aligned)
```python
from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.campaign import Campaign

campaign = AdAccount(f"act_{ad_account_id}").create_campaign(
    fields=[],
    params={
        Campaign.Field.name: campaign_name,
        Campaign.Field.objective: "OUTCOME_LEADS",
        Campaign.Field.status: Campaign.Status.paused,
        Campaign.Field.special_ad_categories: [],
        "smart_promotion_type": "GUIDED_CREATION",
    }
)
campaign_id = campaign["id"]
```

## Create Ad Set (Broad targeting — no interests)
```python
from facebook_business.adobjects.adset import AdSet

adset = AdAccount(f"act_{ad_account_id}").create_ad_set(
    fields=[],
    params={
        AdSet.Field.name: adset_name,
        AdSet.Field.campaign_id: campaign_id,
        AdSet.Field.daily_budget: daily_budget_cents,
        AdSet.Field.billing_event: "IMPRESSIONS",
        AdSet.Field.optimization_goal: "LEAD_GENERATION",
        AdSet.Field.bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        AdSet.Field.targeting: {
            "geo_locations": {"countries": ["AR", "MX", "CO", "CL"]},
        },
        AdSet.Field.start_time: start_time.isoformat(),
        AdSet.Field.status: "PAUSED",
    }
)
adset_id = adset["id"]
```

## Upload Image Creative (from S3 URL)
```python
from facebook_business.adobjects.adimage import AdImage

image = AdAccount(f"act_{ad_account_id}").create_ad_image(
    params={"url": s3_image_url}
)
image_hash = image["images"][s3_image_url]["hash"]
```

## Create Ad Creative
```python
from facebook_business.adobjects.adcreative import AdCreative

creative = AdAccount(f"act_{ad_account_id}").create_ad_creative(
    fields=[],
    params={
        AdCreative.Field.name: creative_name,
        AdCreative.Field.object_story_spec: {
            "page_id": facebook_page_id,
            "link_data": {
                "image_hash": image_hash,
                "link": destination_url,
                "message": ad_copy,
                "call_to_action": {"type": "LEARN_MORE"},
            }
        },
    }
)
creative_id = creative["id"]
```

## Create Ad
```python
from facebook_business.adobjects.ad import Ad

ad = AdAccount(f"act_{ad_account_id}").create_ad(
    fields=[],
    params={
        Ad.Field.name: ad_name,
        Ad.Field.adset_id: adset_id,
        Ad.Field.creative: {"creative_id": creative_id},
        Ad.Field.status: "PAUSED",
    }
)
```

## Read Campaign KPIs (for dashboard)
```python
from facebook_business.adobjects.adsinsights import AdsInsights

insights = AdAccount(f"act_{ad_account_id}").get_insights(
    fields=[
        AdsInsights.Field.spend,
        AdsInsights.Field.impressions,
        AdsInsights.Field.reach,
        AdsInsights.Field.clicks,
        AdsInsights.Field.ctr,
        AdsInsights.Field.cpc,
        AdsInsights.Field.cpm,
        AdsInsights.Field.actions,
        AdsInsights.Field.cost_per_action_type,
        AdsInsights.Field.frequency,
        AdsInsights.Field.video_play_actions,
        AdsInsights.Field.video_thruplay_watched_actions,
    ],
    params={
        "date_preset": "last_7d",
        "level": "ad",
        "breakdowns": [],
    }
)
```

## Andromeda rules for campaign structure
- Targeting: ALWAYS broad — no interests, no lookalikes
- Use Advantage+ placements: yes
- CBO (Campaign Budget Optimization): yes
- Start with PAUSED status, activate after creative review
- Minimum budget: $10/day to exit learning phase
- Do NOT edit targeting or creative in first 7 days (resets learning)
- Scale: increase budget max 20% per day when ROAS is stable

## Credentials
Each project has its own meta_access_token in DB (Fernet encrypted).
Server ~/.env has META_ACCESS_TOKEN for the main System User.
Ad Account ID format: act_XXXXXXXXXX
