"""Campaign optimizer — uses Claude to analyze metrics and decide actions per Andromeda rules."""
import json
import logging
import re
import uuid as uuid_module
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.ad_campaign import AdCampaign
from app.models.project import Project
from app.models.optimization_log import CampaignOptimizationLog
from app.models.competitor_cache import CompetitorResearchCache  # noqa: F401 — ensures model is registered
from app.services.ads.meta_campaign import MetaCampaignService
from app.services.meta.ad_library import MetaAdLibraryService
from app.services.claude.client import ClaudeClient
from app.core.config import settings
from app.core.security import get_project_token
from app.utils import _safe_float

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


async def generate_creative_brief(
    campaign_name: str,
    objective: str,
    current_ad: dict,
    metrics: dict,
    project: Project,
    competitor_ads: list[dict] = None,
) -> dict:
    """Call Claude to generate an actionable creative replacement brief for a fatigued ad."""
    language = (project.content_config or {}).get("language", "es")
    ctr_now = metrics.get("ctr", 0)
    ctr_7d_ago = metrics.get("ctr_7d_ago", 0)
    frequency = float(metrics.get("frequency", 0))
    cost_per_result = metrics.get("cost_per_result", 0)
    cpl_7d_ago = metrics.get("cpl_7d_ago", 0)
    days_running = metrics.get("days_running", 0)

    # Build competitor context block
    if competitor_ads:
        comp_lines = [
            f"- {ad.get('page_name', ad.get('competitor', '?'))}: \"{ad.get('body', ad.get('ad_creative_bodies', [''])[0] if ad.get('ad_creative_bodies') else '')[:100]}\""
            for ad in competitor_ads[:4]
        ]
        comp_block = (
            "COMPETITOR CREATIVES CURRENTLY RUNNING:\n"
            + "\n".join(comp_lines)
            + "\nYour replacement must use a different angle than what competitors are running."
        )
    else:
        comp_block = ""

    prompt = f"""You are a Meta Ads creative strategist expert in the Andromeda algorithm.

Campaign: {campaign_name}
Objective: {objective}
Ad name: {current_ad.get('name', 'unknown')}
Current ad copy: {current_ad.get('creative', {}).get('body', 'unknown')}

Fatigue metrics:
- CTR now: {ctr_now}% / CTR 7 days ago: {ctr_7d_ago}%
- Frequency: {frequency} (Andromeda limit: 3.0)
- CPL now: ${cost_per_result} / CPL 7 days ago: ${cpl_7d_ago}
- Days running: {days_running}

Brand:
- Product: {(project.content_config or {}).get('core_message')}
- Audience: {(project.content_config or {}).get('target_audience')}
- Language: {language}

{comp_block}

The creative is fatigued. Generate a replacement brief.

REPLACEMENT BRIEF RULES:
- The replacement angle MUST be the psychological OPPOSITE of the current one
  (Logical → Emotional, Educational → Controversial, Authority → Vulnerability)
- The hook must score 3U+ on the 4U scale (Urgent, Unique, Ultra-specific, Useful)
- Apply FAB framework: translate every feature into a specific life benefit
- For LATAM retargeting audiences: acknowledge they already know the brand,
  skip awareness, go straight to transformation or social proof

Return ONLY valid JSON:
{{
  "fatigue_diagnosis": "one sentence — exactly why this creative is fatigued",
  "current_angle": "Logical | Emotional | Social Proof | Problem-Solution",
  "current_persona": "who the current ad targets",
  "replacement_angle": "OPPOSITE angle — must differ from current",
  "replacement_persona": "different persona to target",
  "replacement_awareness": "Problem-aware | Solution-aware | Product-aware",
  "suggested_hook": "exact opening line in {language}",
  "suggested_body": "main message max 125 chars in {language}",
  "visual_direction": "what image/video should show — specific and actionable",
  "what_to_avoid": "exactly what NOT to repeat from current creative",
  "urgency": "high | medium",
  "urgency_reason": "why replace now vs later"
}}"""

    response, _usage = await claude_client.generate_content(prompt)
    text = re.sub(r'^```(?:json)?\n?', '', response.strip())
    text = re.sub(r'\n?```$', '', text)
    return json.loads(text)


def _check_high_ctr_low_conversion(
    metrics: dict,
    days_since_created: int,
    objective: str | None,
) -> dict | None:
    """
    Detect high-CTR + low-conversion-rate pattern that suggests a landing page issue.

    Conditions (all must be true):
    - Objective is OUTCOME_SALES
    - CTR > 3.0%
    - Conversion rate (purchases / link_clicks * 100) < 1.0%
    - Total spend >= $30
    - Campaign active >= 5 days

    Returns a dict with the details if the pattern is detected, else None.
    """
    if not objective or "SALES" not in objective.upper():
        return None

    if days_since_created < 5:
        return None

    total_spend = float(metrics.get("spend", 0.0))
    if total_spend < 30.0:
        return None

    ctr = float(metrics.get("ctr", 0.0))
    if ctr <= 3.0:
        return None

    # Extract link clicks and purchase conversions from actions list
    PURCHASE_ACTION_TYPES = {
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "omni_purchase",
        "onsite_web_purchase",
    }
    actions_list = metrics.get("actions", [])
    if not isinstance(actions_list, list):
        return None

    actions = {a["action_type"]: _safe_float(a.get("value")) for a in actions_list if a.get("action_type")}

    link_clicks = actions.get("link_click", 0.0)
    if link_clicks <= 0:
        return None

    purchases = sum(v for k, v in actions.items() if k in PURCHASE_ACTION_TYPES)
    conversion_rate = (purchases / link_clicks) * 100

    if conversion_rate >= 1.0:
        return None

    return {
        "ctr": round(ctr, 2),
        "link_clicks": int(link_clicks),
        "purchases": int(purchases),
        "conversion_rate": round(conversion_rate, 2),
        "total_spend": round(total_spend, 2),
        "days_running": days_since_created,
    }


def _detect_fatigue(metrics: dict, days_since_created: int) -> dict | None:
    """
    Check Andromeda fatigue conditions.
    Returns a dict with fatigue details if fatigued, else None.
    """
    frequency = float(metrics.get("frequency", 0))
    ctr_now = float(metrics.get("ctr", 0))
    ctr_7d_ago = float(metrics.get("ctr_7d_ago", ctr_now))  # fallback to current if not available
    cost_per_result = float(metrics.get("cost_per_result", 0))
    cpl_7d_ago = float(metrics.get("cpl_7d_ago", cost_per_result))

    fatigued = False
    reasons = []

    if frequency > 3.0:
        fatigued = True
        reasons.append(f"frequency_over_3 ({frequency:.1f})")

    if ctr_7d_ago > 0:
        ctr_drop_pct = ((ctr_7d_ago - ctr_now) / ctr_7d_ago) * 100
        if ctr_drop_pct >= 30:
            fatigued = True
            reasons.append(f"ctr_dropped_{ctr_drop_pct:.0f}pct")
    else:
        ctr_drop_pct = 0.0

    if cpl_7d_ago > 0:
        cpl_increase_pct = ((cost_per_result - cpl_7d_ago) / cpl_7d_ago) * 100
        if cpl_increase_pct >= 50:
            fatigued = True
            reasons.append(f"cpl_increased_{cpl_increase_pct:.0f}pct")
    else:
        cpl_increase_pct = 0.0

    if not fatigued:
        return None

    # Compute a friendly ctr_drop for display (0 if no historical data)
    if ctr_7d_ago > 0:
        display_ctr_drop = ((ctr_7d_ago - ctr_now) / ctr_7d_ago) * 100
    else:
        display_ctr_drop = 0.0

    return {
        "frequency": frequency,
        "ctr_now": ctr_now,
        "ctr_7d_ago": ctr_7d_ago,
        "ctr_drop_pct": display_ctr_drop,
        "cost_per_result": cost_per_result,
        "cpl_7d_ago": cpl_7d_ago,
        "days_running": days_since_created,
        "reasons": reasons,
    }


def _can_optimize(metrics: dict) -> tuple[bool, str]:
    """
    Hard guards that prevent optimization regardless of what Claude says.
    These are non-negotiable Andromeda rules.
    """
    days_running = int(metrics.get("days_running", 0))
    total_spend = float(metrics.get("total_spend", 0.0))

    if days_running < 7:
        return False, f"Learning phase active ({days_running}/7 days). No changes until day 7."

    if total_spend < 50.0:
        return False, f"Insufficient spend (${total_spend:.2f}/$50.00 minimum). Wait for more data."

    return True, "OK"


async def analyze_campaign(
    campaign: AdCampaign,
    project: Project,
    db: AsyncSession,
) -> dict:
    """Fetch metrics, call Claude, execute decision, log result."""
    token = await get_project_token(project, db)

    if not token or not campaign.meta_campaign_id:
        return {"skipped": True, "reason": "no token or meta_campaign_id"}

    # 1. Fetch 7-day insights
    metrics = await meta_service.fetch_campaign_insights(token, campaign.meta_campaign_id, "last_7d")

    if not metrics:
        return {"skipped": True, "reason": "no metrics yet (campaign too new)"}

    # 2. Build prompt for Claude
    days_since_created = (datetime.now(timezone.utc).replace(tzinfo=None) - campaign.created_at).days

    # Hard guards — check before calling Claude
    guard_metrics = {
        "days_running": days_since_created,
        "total_spend": float(metrics.get("spend", 0.0)),
    }
    can_optimize, reason = _can_optimize(guard_metrics)
    if not can_optimize:
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"Optimization blocked for campaign {campaign.id}: {reason}")
        log = CampaignOptimizationLog(
            campaign_id=campaign.id,
            project_id=campaign.project_id,
            metrics_snapshot=json.dumps(metrics),
            decision="KEEP",
            rationale=reason,
            action_taken="BLOCKED_BY_GUARD",
            old_budget=campaign.daily_budget or 0.0,
            new_budget=None,
        )
        db.add(log)
        campaign.last_optimized_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()
        return {
            "campaign_id": campaign.id,
            "campaign_name": campaign.name,
            "decision": "KEEP",
            "rationale": reason,
            "action_taken": "BLOCKED_BY_GUARD",
            "old_budget": campaign.daily_budget or 0.0,
            "new_budget": campaign.daily_budget or 0.0,
            "recommendations": [],
            "fatigue_detected": False,
        }

    # 2b. Fetch last 3 optimization decisions for this campaign
    history_result = await db.execute(
        select(CampaignOptimizationLog)
        .where(CampaignOptimizationLog.campaign_id == campaign.id)
        .order_by(CampaignOptimizationLog.checked_at.desc())
        .limit(3)
    )
    history = history_result.scalars().all()
    history_text = "\n".join(
        [f"- {h.checked_at.strftime('%Y-%m-%d')}: {h.decision} — {h.rationale}" for h in history]
    ) or "No previous optimizations"

    # 2c. Fetch competitor ads (cached, 48h TTL)
    competitor_ads: list[dict] = []
    try:
        ad_lib = MetaAdLibraryService()
        competitor_ads = await ad_lib.get_competitor_ads_cached(db, project, token)
    except Exception:
        competitor_ads = []

    if competitor_ads:
        comp_lines = [
            f"- {ad.get('page_name', ad.get('competitor', '?'))}: {(ad.get('body') or (ad.get('ad_creative_bodies') or ['?'])[0])[:80]}"
            for ad in competitor_ads[:5]
        ]
        comp_text = "\n".join(comp_lines)
    else:
        comp_text = "No competitor data available"

    prompt = f"""Analyze this Meta Ads campaign and decide what action to take.

CAMPAIGN INFO:
- Name: {campaign.name}
- Objective: {campaign.objective or "UNKNOWN"}
- Daily budget: ${campaign.daily_budget or 0:.2f}
- Days running: {days_since_created}  ← AUTHORITATIVE. Do NOT infer age from metrics spend or impressions — Meta metrics window is 7 days regardless of campaign age.
- Status: {campaign.status}

LAST 7 DAYS METRICS (window = last 7 days only, not total campaign lifetime):
- Spend: ${float(metrics.get('spend', 0)):.2f}
- Impressions: {metrics.get('impressions', 0)}
- Reach: {metrics.get('reach', 0)}
- CTR: {float(metrics.get('ctr', 0)):.2f}%
- CPM: ${float(metrics.get('cpm', 0)):.2f}
- CPC: ${float(metrics.get('cpc', 0)):.2f}
- Frequency: {float(metrics.get('frequency', 0)):.2f}
- Actions: {json.dumps(metrics.get('actions', []))}
- Action values (revenue): {json.dumps(metrics.get('action_values', []))}
- Cost per action: {json.dumps(metrics.get('cost_per_action_type', []))}
- Purchase ROAS (from Meta): {json.dumps(metrics.get('purchase_roas', []))}

OPTIMIZATION HISTORY (last 3 decisions):
{history_text}

COMPETITOR ADS (currently active — longer-running ads are likely performing):
{comp_text}

CRITICAL RULES:
- The "Days running" value above is the authoritative campaign age. Never override it with inferences from spend or impressions volume.
- Metrics show only the last 7-day window — low spend does not mean the campaign is new.
- Consider the optimization history to avoid repeating the same decision if it did not improve metrics.
- Use competitor context when suggesting creative modifications.
Return your JSON decision."""

    # 3. Call Claude
    try:
        response_text, _usage = await claude_client.generate_content(prompt, ANDROMEDA_SYSTEM_PROMPT)
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
    from app.models.notification import Notification

    notification_svc = NotificationService(db)
    action_taken = "PENDING_APPROVAL"

    # 5. Detect fatigue independently of Claude's decision
    fatigue_info = _detect_fatigue(metrics, days_since_created)

    # 5b. Detect high CTR + low conversion rate (landing page issue signal)
    lp_issue = _check_high_ctr_low_conversion(metrics, days_since_created, campaign.objective)

    # Check for existing pending notification for this campaign (avoid duplicates)
    existing_notif_result = await db.execute(
        select(Notification).where(
            Notification.project_id == campaign.project_id,
            Notification.type.in_(["optimizer_scale", "optimizer_pause"]),
            Notification.is_read == False,  # noqa: E712
        ).order_by(Notification.created_at.desc())
    )
    existing_notifs = existing_notif_result.scalars().all()
    pending_campaign_ids = {
        (n.action_data or {}).get("campaign_id")
        for n in existing_notifs
    }

    try:
        if decision == "SCALE":
            if campaign.id in pending_campaign_ids:
                action_taken = "NO_ACTION"  # already has a pending SCALE/PAUSE notification
            else:
                MAX_BUDGET_MULTIPLIER = 1.3
                proposed_multiplier = analysis.get("new_budget_multiplier", 1.2)
                safe_multiplier = min(proposed_multiplier, MAX_BUDGET_MULTIPLIER)
                if safe_multiplier < proposed_multiplier:
                    logger.warning(
                        f"Budget multiplier capped from {proposed_multiplier} to {MAX_BUDGET_MULTIPLIER} for campaign {campaign.id}"
                    )
                new_budget = round(old_budget * safe_multiplier, 2)
                new_budget = max(new_budget, 10.0)
                approval_token = str(uuid_module.uuid4())[:16]
                await notification_svc.create(
                    type="optimizer_scale",
                    title=f"Escalar presupuesto recomendado — {campaign.name}",
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
            if campaign.id in pending_campaign_ids:
                action_taken = "NO_ACTION"  # already has a pending SCALE/PAUSE notification
            else:
                approval_token = str(uuid_module.uuid4())[:16]
                spend = float(metrics.get("spend", 0))
                await notification_svc.create(
                    type="optimizer_pause",
                    title=f"Pausar campaña recomendado — {campaign.name}",
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

        # 6. If fatigue detected, generate creative brief and create dedicated notification
        if fatigue_info:
            await _create_fatigue_notification(
                campaign=campaign,
                project=project,
                metrics=metrics,
                fatigue_info=fatigue_info,
                notification_svc=notification_svc,
                competitor_ads=competitor_ads,
            )

        # 7. Check for high CTR + low conversion rate (landing page issue signal)
        if lp_issue:
            await _create_high_ctr_low_conversion_notification(
                campaign=campaign,
                lp_issue=lp_issue,
                notification_svc=notification_svc,
                db=db,
            )

    except Exception as e:
        rationale = f"{rationale} (Notification failed: {str(e)})"
        action_taken = "ERROR"

    # 7. Log to DB
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
    campaign.last_optimized_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
        "fatigue_detected": fatigue_info is not None,
        "high_ctr_low_conversion_detected": lp_issue is not None,
    }


async def _create_fatigue_notification(
    campaign: AdCampaign,
    project: Project,
    metrics: dict,
    fatigue_info: dict,
    notification_svc,
    competitor_ads: list[dict] = None,
) -> None:
    """Generate creative brief and create campaign_fatigued notification + Telegram message."""
    # Determine current ad info (use campaign stored copy info as fallback)
    current_ad = {
        "name": campaign.name,
        "creative": {"body": campaign.ad_copy or ""},
    }

    # Enrich metrics for brief generation
    enriched_metrics = {
        **metrics,
        "ctr": fatigue_info["ctr_now"],
        "ctr_7d_ago": fatigue_info["ctr_7d_ago"],
        "cost_per_result": fatigue_info["cost_per_result"],
        "cpl_7d_ago": fatigue_info["cpl_7d_ago"],
        "days_running": fatigue_info["days_running"],
        "frequency": fatigue_info["frequency"],
    }

    # Generate creative brief via Claude
    brief: dict = {}
    try:
        brief = await generate_creative_brief(
            campaign_name=campaign.name,
            objective=campaign.objective or "OUTCOME_LEADS",
            current_ad=current_ad,
            metrics=enriched_metrics,
            project=project,
            competitor_ads=competitor_ads,
        )
    except Exception:
        brief = {
            "fatigue_diagnosis": "Creativo fatigado por alta frecuencia o caída de CTR.",
            "current_angle": "Desconocido",
            "current_persona": "Audiencia general",
            "replacement_angle": "Emocional",
            "replacement_persona": "Nueva audiencia objetivo",
            "replacement_awareness": "Problem-aware",
            "suggested_hook": "Descubrí una forma mejor de lograrlo",
            "suggested_body": "Mensaje de reemplazo sugerido por Andromeda.",
            "visual_direction": "Imagen de persona usando el producto con resultado visible.",
            "what_to_avoid": "Repetir el mismo ángulo y mensaje del creativo actual.",
            "urgency": "high",
            "urgency_reason": "Frecuencia alta deteriora la tasa de conversión rápidamente.",
        }

    frequency = fatigue_info["frequency"]
    ctr_drop = fatigue_info["ctr_drop_pct"]
    approval_token = str(uuid_module.uuid4())[:16]

    message = (
        f"CTR cayó {ctr_drop:.0f}% en 7 días. "
        f"Frecuencia: {frequency:.1f}. "
        f"Sugerencia: cambiar a ángulo {brief.get('replacement_angle', 'diferente')}."
    )

    action_data = {
        "type": "creative_refresh",
        "campaign_id": campaign.id,
        "campaign_name": campaign.name,
        "ad_id": campaign.meta_ad_id or "",
        "ad_name": current_ad["name"],
        "approval_token": approval_token,
        "metrics": {
            "ctr_current": fatigue_info["ctr_now"],
            "ctr_7d_ago": fatigue_info["ctr_7d_ago"],
            "ctr_drop_pct": ctr_drop,
            "frequency": frequency,
            "cost_per_result": fatigue_info["cost_per_result"],
            "cpl_7d_ago": fatigue_info["cpl_7d_ago"],
            "days_running": fatigue_info["days_running"],
        },
        "creative_brief": brief,
    }

    await notification_svc.create(
        type="campaign_fatigued",
        title=f"⚠️ Creativo fatigado — {campaign.name}",
        message=message,
        project_id=campaign.project_id,
        action_url=f"/dashboard/ads/{campaign.id}",
        action_label="Ver brief completo",
        action_data=action_data,
    )

    # Send Telegram notification if configured
    if project.telegram_chat_id:
        try:
            from app.services.telegram.bot import TelegramBot
            from app.core.config import settings as app_settings

            telegram_token = getattr(app_settings, "TELEGRAM_BOT_TOKEN", "")
            if telegram_token:
                bot = TelegramBot(telegram_token)
                current_angle = brief.get("current_angle", "desconocido")
                replacement_angle = brief.get("replacement_angle", "diferente")
                suggested_hook = brief.get("suggested_hook", "")
                telegram_text = (
                    f"⚠️ Creativo fatigado — {campaign.name}\n\n"
                    f"📉 CTR cayó {ctr_drop:.0f}% en 7 días\n"
                    f"📊 Frecuencia: {frequency:.1f} (límite Andromeda: 3.0)\n\n"
                    f"💡 Claude sugiere:\n"
                    f"Cambiar de ángulo {current_angle} → {replacement_angle}\n"
                    f"Hook sugerido: '{suggested_hook}'\n\n"
                    f"👉 Abrí el dashboard para ver el brief completo y subir el nuevo creativo."
                )
                await bot.send_message(project.telegram_chat_id, telegram_text)
        except Exception:
            pass  # Telegram failure should never break the optimizer flow


async def _create_high_ctr_low_conversion_notification(
    campaign: AdCampaign,
    lp_issue: dict,
    notification_svc,
    db: AsyncSession,
) -> None:
    """
    Create a high_ctr_low_conversion notification if one hasn't been sent
    for this campaign in the last 7 days (cooldown).
    """
    from datetime import timedelta
    from app.models.notification import Notification

    cooldown_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    existing_result = await db.execute(
        select(Notification).where(
            Notification.project_id == campaign.project_id,
            Notification.type == "high_ctr_low_conversion",
            Notification.created_at >= cooldown_cutoff,
        )
    )
    existing = existing_result.scalars().all()
    # Filter by campaign_id in action_data (cooldown is per campaign)
    for notif in existing:
        if (notif.action_data or {}).get("campaign_id") == campaign.id:
            return  # Still within cooldown window — skip

    ctr = lp_issue["ctr"]
    conv_rate = lp_issue["conversion_rate"]

    title = f"Landing page may have an issue — {campaign.name}"
    message = (
        f"Your campaign has a {ctr:.1f}% CTR but only {conv_rate:.1f}% of clicks convert. "
        f"People are clicking but not buying. Check your landing page, price point, or checkout flow."
    )

    await notification_svc.create(
        type="high_ctr_low_conversion",
        title=title,
        message=message,
        project_id=campaign.project_id,
        action_url=f"/dashboard/ads/{campaign.id}",
        action_label="View campaign",
        action_data={
            "campaign_id": campaign.id,
            "campaign_name": campaign.name,
            "metrics": {
                "ctr": ctr,
                "link_clicks": lp_issue["link_clicks"],
                "purchases": lp_issue["purchases"],
                "conversion_rate": conv_rate,
                "total_spend": lp_issue["total_spend"],
                "days_running": lp_issue["days_running"],
            },
        },
    )


async def run_optimization_cycle(db: AsyncSession) -> list[dict]:
    """Run optimization for all active campaigns that haven't been checked in 3 days."""
    from datetime import timedelta, timezone

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=3)

    result = await db.execute(
        select(AdCampaign).where(
            AdCampaign.status == "active",
            AdCampaign.meta_campaign_id.isnot(None),
            (AdCampaign.last_optimized_at == None) | (AdCampaign.last_optimized_at <= cutoff)
        )
    )
    campaigns = result.scalars().all()
    logger.info("[Optimizer] Found %d eligible campaigns (cutoff: %s)", len(campaigns), cutoff)

    results = []
    for campaign in campaigns:
        try:
            logger.info("[Optimizer] Processing campaign %s — %s", campaign.id, campaign.name)
            proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
            project = proj_result.scalar_one_or_none()
            if project:
                r = await analyze_campaign(campaign, project, db)
                results.append(r)
        except Exception as e:
            logger.exception("Optimizer failed for campaign %s: %s", campaign.id, e)
            await db.rollback()
            continue

    return results
