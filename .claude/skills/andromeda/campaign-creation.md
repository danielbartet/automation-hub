---
name: andromeda-campaign-creation
description: "ALWAYS use this skill when creating Meta Ads campaigns or ad sets. Load it whenever: creating a new campaign, deciding how many creatives to upload, structuring ad sets, choosing targeting, or planning creative diversity. This skill contains the Andromeda-specific rules that override standard Meta Ads best practices. Do NOT create campaigns without loading this skill first."
---

# Andromeda Campaign Creation Skill

## What is Andromeda (technical reality)
Andromeda is Meta's AI-powered ads retrieval engine. It processes tens of millions of ads in ~300ms using NVIDIA Grace Hopper Superchip — a 10,000x increase in model complexity vs previous systems.

Key insight: Andromeda runs BEFORE the auction. It decides which ads even get to compete. If your ads don't pass retrieval, they never enter the auction regardless of bid.

## The Entity ID — the most critical concept

Andromeda assigns an Entity ID to each ad based on its semantic and visual fingerprint (pixels, audio, text, narrative).

The Entity ID Trap:
Ads with more than 60% semantic similarity get clustered under ONE Entity ID and receive only ONE auction ticket combined.

Cluster Suppression (the hidden danger):
If Andromeda determines a cluster's concept is weak or fatigued, it suppresses ALL variations in that cluster simultaneously. This is why winning ad sets suddenly die — the entire cluster was judged as irrelevant, not just one ad.

Rule: Never create minor variations. Test conceptually different ads, not cosmetically different ones.

## Optimal campaign structure (Andromeda-First)

1 Campaign (CBO — Campaign Budget Optimization)
  1-2 Ad Sets maximum (broad targeting)
    10-25 unique creatives per ad set

Meta's own data: 17% more conversions at 16% lower cost with 1 ad set + 25 creatives vs multiple ad sets with fewer creatives.

DO NOT:
- Create 5-10 ad sets (splits learning data, creates internal competition)
- Use detailed interest targeting (overrides Andromeda's retrieval)
- Create minor variations of the same concept (Entity ID trap)

## Creative diversity requirements

You need 10-25 genuinely distinct creatives per ad set. Diversity must happen across BOTH dimensions:

Dimension 1: Psychological angle (P.D.A. Framework)
Vary all three for each concept:
- Persona: Who is speaking/being addressed (e.g. overwhelmed junior dev vs ambitious senior)
- Desire: What outcome they want (save time, gain status, avoid risk, belong)
- Conciencia: Funnel stage (Problem-aware, Solution-aware, Product-aware)

Dimension 2: Format and visual approach
Each ad set must include multiple formats:
- Short video (15-30s Reels)
- Long video (60s+ for deeper narratives)
- Static image (1:1 or 4:5 for Feed)
- Carousel (multiple cards)
- Text-heavy (for Problem-aware audiences)

4 psychological angles to rotate between:
1. Logical: data, statistics, comparisons, ROI proof
2. Emotional: transformation, relief, aspiration, fear of being left behind
3. Social Proof: results, testimonials, community, UGC-style
4. Problem/Solution: name the pain explicitly, then offer the exit

## Minimum creative set for a new campaign
Before launching, verify you have creatives covering:
- At least 3 different psychological angles
- At least 2 different formats (e.g. video + static)
- At least 3 different P.D.A. combinations
- Zero pairs with more than 60% semantic similarity

Minimum: 6 creatives. Optimal: 10-15 for Andromeda to learn efficiently.

## Hook requirements (first 3 seconds)
Andromeda evaluates relevance in the first 3 seconds. Every creative needs a disruptive hook.

Hook types that generate unique Entity IDs:
- Direct challenge: "El 90% de los developers hace esto mal"
- Surprising statistic: "En 2026, solo el 20% de los devs seguira empleado"
- Pattern interrupt: Start with an unexpected visual or statement
- Question: "Por que tu portfolio no consigue entrevistas?"

Each hook must be visually AND conceptually unique from other hooks in the same ad set.

## Targeting rules (Andromeda-First)
- Always broad: Remove all interest targeting
- Age: 18-65+ (let Andromeda find the right users)
- Geo: AR, MX, CO, CL, PE (or per project config)
- Lookalike audiences: Can be used as signal input but NOT as hard boundary
- Advantage+ audience: ALWAYS enabled
- Advantage+ placements: ALWAYS enabled

## Budget and scaling rules
Starting budget: Minimum $10/day to exit learning phase faster
Learning phase: Requires 50 optimization events — do NOT edit in first 7 days

Budget scaling:
- Increase by 20-30% maximum per adjustment
- Best time to increase: after midnight local timezone
- Wait for 7+ days and 50+ events before first scale
- Never reduce budget during learning phase (resets learning)

Scale trigger:
LEADS: CPL stable for 3+ days and frequency below 2.5 → scale 20-30%
SALES: ROAS above 2.0 stable → scale 20-30%
TRAFFIC: CPC below $0.30 and CTR above 1% → scale 20-30%

Pause trigger:
Frequency above 3.0 → pause, rotate creative pool
CTR drops 30% in 7 days → cluster is fatigued, replace concepts

## Testing strategy: 1-1-1 then 1-1-X

Phase 1 (first 10-12 hours): 1 campaign, 1 ad set, 1 creative
Identify which concept gets traction. Look for:
- Hook Rate above 25% (3-second video plays / impressions)
- Hold Rate above 15% (15-second video plays / impressions)
- CPL or CPA trending toward target

Phase 2: Move winning concept to main 1-1-X campaign
Add 5-10 MORE conceptually different creatives alongside the winner.
Do NOT just make variations of the winner — create new concepts.

Phase 3 (scaling): Find winning Entity IDs
When a concept wins, create new VISUALLY different ads with the SAME conceptual angle.
This generates new Entity IDs but with proven narrative DNA.

## CAPI and EMQ requirements
Andromeda quality = signal quality. Always configure:
- Meta Pixel + Conversions API (CAPI) both firing
- Event Match Quality (EMQ) target: 8.5-9.5
- EMQ below 7 = poor signal → Andromeda cannot optimize → underperformance
- Priority events: Purchase > Lead > AddToCart > ViewContent
- Deduplication: ensure Pixel and CAPI events have matching event_id

## Diversity audit before launching
Before creating the campaign via API, run this checklist:

[ ] At least 10 creatives planned (not just 1-3)
[ ] Covers at least 3 different psychological angles
[ ] Covers at least 2 different formats
[ ] No two creatives share the same hook concept
[ ] No two creatives target the same P.D.A. combination
[ ] All creatives have strong 3-second hook
[ ] Broad targeting configured (no interests)
[ ] Advantage+ enabled
[ ] CBO enabled
[ ] CAPI connected and EMQ above 7

## What NOT to do
- DO NOT create 5 versions of same concept with different color
- DO NOT use detailed interest targeting
- DO NOT edit targeting or creatives in first 7 days
- DO NOT increase budget more than 30% at once
- DO NOT create multiple ad sets to test audiences — test creatives instead
- DO NOT launch with fewer than 6 creatives

## API version
Always use v19.0 for all Marketing API calls.
Use facebook-python-business-sdk — see meta-ads-api.md skill for implementation.
