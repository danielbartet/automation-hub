"""Meta Ads service — stub."""
from app.services.meta.client import MetaClient


class MetaAdsService:
    """Manages Meta Ads campaigns and reporting."""

    def __init__(self, client: MetaClient) -> None:
        self.client = client

    async def get_account_insights(self, ad_account_id: str) -> dict:
        """Fetch account-level ad insights. Returns stub data."""
        return {
            "spend_today": 0.0,
            "spend_this_month": 0.0,
            "active_campaigns": 0,
            "ctr": 0.0,
            "roas": 0.0,
            "conversions": 0,
        }

    async def list_campaigns(self, ad_account_id: str) -> list[dict]:
        """List campaigns for an ad account."""
        return []
