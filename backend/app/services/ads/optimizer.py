"""Campaign optimizer — uses Claude to analyze metrics and decide actions per Andromeda rules."""
import json
import uuid as uuid_module
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.ad_campaign import AdCampaign
from app.models.project import Project
from app.models.optimization_log import CampaignOptimizationLog
from app.services.ads.meta_campaign import MetaCampaignService
from app.services.claude.client import ClaudeClient
from app.core.config import settings

meta_service = MetaCampaignService()
claude_client = ClaudeClient()

ANDROMEDA_SYSTEM_PROMPT = """You are an expert Meta Ads optimizer following the Andromeda algorithm rules.

ANDROMEDA RULES:
- Broad targeting only (no interests, no lookalikes)
- CBO (Campaign Budget Optimization) with LOWEST_COST_WITHOUT_CAP
- Minimum $10/day to exit learning phase
- Do NOT edit targeting or creative in first 7 days (resets learning)
- Scale: increase budget max 20% per day when ROAS is stable
- Frequency > 3.0 = creative fatigue — pause or replace creative
- CTR < 0.5% with 1000+ impressions = weak creative — modify
- For LEADS: healthy CPL = < $5 USD; scale if CPL stable and frequency < 2.5
- For SALES: healthy ROAS = > 2.0; scale if ROAS stable
- For TRAFFIC: healthy CPC = < $0.30; scale if CPC stable and CTR > 1%
- Budget increase: exactly 20% (no more to avoid learning phase reset)
- Minimum data required before scaling: 7 days, $50+ spend

DECISION OUTPUT FORMAT (valid JSON only):
{
  "decision": "SCALE" | "MODIFY" | "PAUSE" | "KEEP",
  "rationale": "one or two sentences explaining why",
  "new_budget_multiplier": 1.2,  // only for SCALE -- always 1.2
  "urgency": "low" | "medium" | "high",
  "recommendations": ["actionable tip 1", "actionable tip 2"]
}"""


async def analyze_campaign(
    campaign: AdCampaign,
    project: Project,
    db: AsyncSession,
) -> dict:
    """Fetch metrics, call Claude, execute decision, log result."""
    token = project.meta_access_token or getattr(settings, "META_ACCESS_TOKEN", "")

    if not token or not campaign.meta_campaign_id:
        return {"skipped": True, "reason": "no token or meta_campaign_id"}

    # 1. Fetch 7-day insights
    metrics = await meta_service.fetch_campaign_insights(token, campaign.meta_campaign_id, "last_7d")

    if not metrics:
        return {"skipped": True, "reason": "no metrics yet (campaign too new)"}

    # 2. Build prompt for Claude
    days_since_created = (datetime.utcnow() - campaign.created_at).days

    prompt = f"""Analyze this Meta Ads campaign and decide what action to take.

CAMPAIGN INFO:
- Name: {campaign.name}
- Objective: {campaign.objective or "UNKNOWN"}
- Daily budget: ${campaign.daily_budget or 0:.2f}
- Days running: {days_since_created}
- Status: {campaign.status}

LAST 7 DAYS METRICS:
- Spend: ${float(metrics.get('spend', 0)):.2f}
- Impressions: {metrics.get('impressions', 0)}
- Reach: {metrics.get('reach', 0)}
- CTR: {float(metrics.get('ctr', 0)):.2f}%
- CPM: ${float(metrics.get('cpm', 0)):.2f}
- CPC: ${float(metrics.get('cpc', 0)):.2f}
- Frequency: {float(metrics.get('frequency', 0)):.2f}
- Actions: {json.dumps(metrics.get('actions', []))}
- Cost per action: {json.dumps(metrics.get('cost_per_action_type', []))}

Apply Andromeda rules and return your JSON decision."""

    # 3. Call Claude
    try:
        response_text = await claude_client.generate_content(prompt, ANDROMEDA_SYSTEM_PROMPT)
        # Strip markdown if present
        text = response_text.strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.rsplit("```", 1)[0].strip()
        analysis = json.loads(text)
    except Exception as e:
        analysis = {
            "decision": "KEEP",
            "rationale": f"Analysis failed: {str(e)}",
            "urgency": "low",
            "recommendations": [],
        }

    decision = analysis.get("decision", "KEEP")
    rationale = analysis.get("rationale", "")
    old_budget = campaign.daily_budget or 0.0
    new_budget = old_budget
    action_taken = "NONE"

    # 4. Create notifications instead of auto-executing
    from app.services.notifications import NotificationService

    notification_svc = NotificationService(db)
    action_taken = "NOTIFICATION_SENT"

    try:
        if decision == "SCALE":
            new_budget = round(old_budget * analysis.get("new_budget_multiplier", 1.2), 2)
            new_budget = max(new_budget, 10.0)
            approval_token = str(uuid_module.uuid4())[:16]
            await notification_svc.create(
                type="optimizer_scale",
                title=f"SCALE recomendado — {campaign.name}",
                message=f"Presupuesto: ${old_budget}/día → ${new_budget}/día. {analysis.get('rationale', '')}",
                project_id=campaign.project_id,
                action_url=f"/dashboard/ads?campaign={campaign.id}",
                action_label="Ver campaña",
                action_data={
                    "campaign_id": campaign.id,
                    "approval_token": approval_token,
                    "action": "scale",
                    "current_budget": old_budget,
                    "new_budget": new_budget,
                },
            )

        elif decision == "PAUSE":
            approval_token = str(uuid_module.uuid4())[:16]
            spend = float(metrics.get("spend", 0))
            await notification_svc.create(
                type="optimizer_pause",
                title=f"PAUSE recomendado — {campaign.name}",
                message=f"{analysis.get('rationale', '')} Gasto: ${spend:.2f}",
                project_id=campaign.project_id,
                action_url=f"/dashboard/ads?campaign={campaign.id}",
                action_label="Ver campaña",
                action_data={
                    "campaign_id": campaign.id,
                    "approval_token": approval_token,
                    "action": "pause",
                },
            )

        elif decision == "MODIFY":
            action_taken = "RECOMMENDATIONS_SENT"

        elif decision == "KEEP":
            action_taken = "NO_ACTION"

    except Exception as e:
        rationale = f"{rationale} (Notification failed: {str(e)})"
        action_taken = "ERROR"

    # 5. Log to DB
    log = CampaignOptimizationLog(
        campaign_id=campaign.id,
        project_id=campaign.project_id,
        metrics_snapshot=json.dumps(metrics),
        decision=decision,
        rationale=rationale,
        action_taken=action_taken,
        old_budget=old_budget,
        new_budget=new_budget if new_budget != old_budget else None,
    )
    db.add(log)
    campaign.last_optimized_at = datetime.utcnow()
    await db.commit()

    return {
        "campaign_id": campaign.id,
        "campaign_name": campaign.name,
        "decision": decision,
        "rationale": rationale,
        "action_taken": action_taken,
        "old_budget": old_budget,
        "new_budget": new_budget,
        "recommendations": analysis.get("recommendations", []),
    }


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

    results = []
    for campaign in campaigns:
        proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
        project = proj_result.scalar_one_or_none()
        if project:
            r = await analyze_campaign(campaign, project, db)
            results.append(r)

    return results
