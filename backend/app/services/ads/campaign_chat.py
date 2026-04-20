"""Campaign Chat — conversational analysis of campaign performance via Claude."""
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.ad_campaign import AdCampaign
from app.models.project import Project
from app.models.user import User
from app.services.ads.meta_campaign import MetaCampaignService
from app.services.claude.client import ClaudeClient
from app.core.security import get_project_token
from app.utils import _safe_float

CHAT_COOLDOWN_MINUTES = 15

meta_service = MetaCampaignService()
claude_client = ClaudeClient()

QUESTION_SYSTEM_PROMPTS: dict[str, str] = {
    "how_are_campaigns": """You are an expert Meta Ads analyst. Your job is to give the user a clear, honest overview of how their campaigns are performing right now.

Structure your answer in 2-4 short paragraphs:
1. Overall health summary — are things going well or not, and why
2. What is working — specific campaigns, metrics, trends showing positive signs
3. What is not working — specific issues worth attention
4. One-sentence bottom line

Be direct and specific. Use the actual campaign names and numbers provided. No fluff, no generic advice.""",

    "wasting_money": """You are a Meta Ads efficiency expert. Your job is to identify exactly where ad spend is being wasted.

Focus on:
- Campaigns with high spend but low or zero conversions
- High CPL or CPA compared to healthy benchmarks ($5 CPL for leads, 2.0x ROAS for sales)
- Campaigns with high frequency (above 2.5) still running at full budget
- Campaigns spending in the learning phase without enough data to optimize

Be specific about amounts and campaign names. Tell the user exactly which campaigns to look at first.""",

    "change_this_week": """You are a Meta Ads strategist giving a weekly action plan. Your job is to give 3-5 concrete, actionable recommendations the user can execute this week.

Each recommendation must:
- Reference a specific campaign by name
- Specify the exact action (pause, reduce budget to $X/day, change creative, etc.)
- Explain the reason in one sentence based on the metrics

Format your answer as a numbered list of actions, then a brief 1-2 sentence summary of expected impact.""",

    "creative_fatigue": """You are a Meta Ads creative strategist. Your job is to evaluate creative fatigue across all campaigns.

For each campaign, assess:
- Frequency (Andromeda rule: above 3.0 = fatigued, above 2.5 = at risk)
- CTR trend (a significant drop indicates fatigue)
- Days running (older campaigns more likely fatigued)

Categorize campaigns as: FATIGUED (action needed now), AT RISK (watch closely), or HEALTHY.
For fatigued campaigns, suggest what angle or format the replacement creative should use.""",

    "ready_to_scale": """You are a Meta Ads scaling expert following the Andromeda algorithm.

Andromeda scale conditions (ALL must be met):
- Campaign active for at least 7 days
- Minimum $50 total spend
- ROAS above 2.0 (for sales) OR CPL below $5 (for leads)
- Frequency below 2.5
- Scaling = 20% budget increase (never more — risks resetting learning phase)

Evaluate each campaign against these criteria. Clearly state:
- Which campaigns are READY to scale (and what the new budget would be)
- Which campaigns are NOT ready yet (and what's blocking them)
- Any campaigns that should NOT be scaled (and why)""",
}


def _format_campaign_data(campaigns_metrics: list[dict]) -> str:
    """Format campaign metrics into a readable text block for the prompt."""
    if not campaigns_metrics:
        return "No active campaigns with metrics found."

    lines = []
    for c in campaigns_metrics:
        name = c.get("name", "Unknown")
        objective = c.get("objective", "UNKNOWN")
        status = c.get("status", "unknown")
        daily_budget = c.get("daily_budget", 0) or 0
        days_running = c.get("days_running", 0)
        metrics = c.get("metrics", {})

        spend = float(metrics.get("spend", 0) or 0)
        impressions = int(metrics.get("impressions", 0) or 0)
        ctr = float(metrics.get("ctr", 0) or 0)
        frequency = float(metrics.get("frequency", 0) or 0)
        cpm = float(metrics.get("cpm", 0) or 0)
        cpc = float(metrics.get("cpc", 0) or 0)

        # Extract action-based KPIs
        actions_list = metrics.get("actions", [])
        actions = {}
        if isinstance(actions_list, list):
            actions = {a["action_type"]: _safe_float(a.get("value")) for a in actions_list if a.get("action_type")}

        cost_per_action = metrics.get("cost_per_action_type", [])
        cpa_map = {}
        if isinstance(cost_per_action, list):
            cpa_map = {a["action_type"]: _safe_float(a.get("value")) for a in cost_per_action if a.get("action_type")}

        leads = actions.get("lead", 0)
        cpl = cpa_map.get("lead", 0)
        purchases = sum(v for k, v in actions.items() if "purchase" in k.lower())
        cpa_purchase = next((v for k, v in cpa_map.items() if "purchase" in k.lower()), 0)

        # ROAS — use Meta's native purchase_roas field only (same as optimizer).
        # Do NOT fall back to action_values / spend: action_values sums revenue
        # across ALL action types when unfiltered, and even when filtered by
        # "purchase" it may differ from Meta's own attribution model, producing
        # a wildly different number than what the optimizer reports.
        purchase_roas_list = metrics.get("purchase_roas", [])
        if isinstance(purchase_roas_list, list) and purchase_roas_list:
            roas = _safe_float(purchase_roas_list[0].get("value"))
        else:
            roas = 0.0

        lines.append(f"""
Campaign: {name}
  Objective: {objective} | Status: {status}
  Daily budget: ${daily_budget:.2f}/day | Days running: {days_running}
  --- Last 7 days ---
  Spend: ${spend:.2f} | Impressions: {impressions:,}
  CTR: {ctr:.2f}% | Frequency: {frequency:.2f} | CPM: ${cpm:.2f} | CPC: ${cpc:.2f}
  Leads: {int(leads)} | CPL: ${cpl:.2f}
  Purchases: {int(purchases)} | CPA: ${cpa_purchase:.2f} | ROAS: {roas:.2f}x""")

    return "\n".join(lines)


async def run_campaign_chat(
    question_key: str,
    project_slug: str,
    user: User,
    db: AsyncSession,
    language: str = "en",
    campaign_id: int | None = None,
) -> dict:
    """
    Main entry point for campaign chat.
    Returns answer dict or raises ValueError for cooldown.
    """
    # 1. Check cooldown
    if user.last_chat_at is not None:
        elapsed = datetime.now(timezone.utc).replace(tzinfo=None) - user.last_chat_at
        cooldown_total = timedelta(minutes=CHAT_COOLDOWN_MINUTES)
        if elapsed < cooldown_total:
            remaining = int((cooldown_total - elapsed).total_seconds())
            raise CooldownError(remaining)

    # 2. Load project
    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise ValueError(f"Project '{project_slug}' not found")

    # 3. Load active campaigns (optionally filtered to a specific campaign)
    where_clauses = [
        AdCampaign.project_id == project.id,
        func.lower(AdCampaign.status) == "active",
        AdCampaign.meta_campaign_id.isnot(None),
    ]
    if campaign_id:
        where_clauses.append(AdCampaign.id == campaign_id)
    campaigns_result = await db.execute(
        select(AdCampaign).where(*where_clauses)
    )
    campaigns = campaigns_result.scalars().all()

    # 4. Fetch metrics for each campaign
    token = await get_project_token(project, db)
    campaigns_metrics = []

    # Use last_7d to match the optimizer's decision window.
    # The optimizer runs Andromeda rules on 7-day signals; using 30-day data here
    # would produce different purchase counts / ROAS and lead to contradictory advice.
    if token and campaigns:
        for campaign in campaigns:
            try:
                metrics = await meta_service.fetch_campaign_insights(
                    token, campaign.meta_campaign_id, date_preset="last_7d"
                )
                days_running = (datetime.now(timezone.utc).replace(tzinfo=None) - campaign.created_at).days
                campaigns_metrics.append({
                    "name": campaign.name,
                    "objective": campaign.objective,
                    "status": campaign.status,
                    "daily_budget": campaign.daily_budget,
                    "days_running": days_running,
                    "metrics": metrics or {},
                })
            except Exception:
                campaigns_metrics.append({
                    "name": campaign.name,
                    "objective": campaign.objective,
                    "status": campaign.status,
                    "daily_budget": campaign.daily_budget,
                    "days_running": (datetime.now(timezone.utc).replace(tzinfo=None) - campaign.created_at).days,
                    "metrics": {},
                })
    elif campaigns:
        # No token — include campaigns without metrics
        for campaign in campaigns:
            campaigns_metrics.append({
                "name": campaign.name,
                "objective": campaign.objective,
                "status": campaign.status,
                "daily_budget": campaign.daily_budget,
                "days_running": (datetime.now(timezone.utc).replace(tzinfo=None) - campaign.created_at).days,
                "metrics": {},
            })

    # 5. Build prompt
    system_prompt = QUESTION_SYSTEM_PROMPTS.get(question_key, QUESTION_SYSTEM_PROMPTS["how_are_campaigns"])
    if language == "es":
        system_prompt += "\n\nResponde en español."
    campaigns_text = _format_campaign_data(campaigns_metrics)

    user_prompt = f"""Here is the current state of the campaigns for project "{project.name}":

{campaigns_text}

Please analyze this data and answer my question."""

    # 6. Call Claude
    answer, _chat_usage = await claude_client.generate_content(user_prompt, system_prompt)

    # 7. Log token usage
    from app.services.token_usage import log_token_usage
    await log_token_usage(
        db=db,
        user_id=user.id,
        project_id=project.id,
        usage=_chat_usage,
        operation_type="campaign_chat",
    )

    # 8. Update cooldown timestamp
    user.last_chat_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()

    return {
        "answer": answer,
        "generated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "cooldown_remaining_seconds": 0,
    }


class CooldownError(Exception):
    def __init__(self, remaining_seconds: int):
        self.remaining_seconds = remaining_seconds
        super().__init__(f"Cooldown active: {remaining_seconds}s remaining")
