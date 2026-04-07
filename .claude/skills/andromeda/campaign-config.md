---
name: andromeda-campaign-config
description: "ALWAYS use this skill when creating or configuring Meta Ads campaigns. Load it whenever: setting up campaigns, structuring ad sets, configuring Advantage+, choosing objectives, or deciding targeting strategy. Do not configure Meta campaigns without this skill — it contains Andromeda-specific rules that differ from standard Meta best practices."
---

# Andromeda Campaign Config Skill

## Campaign Structure (Andromeda-optimized)
Andromeda works best with simplified structures. More ad sets = fragmented learning. Fewer, broader ad sets = faster learning and better optimization.

Recommended structure:
- 1 Campaign per objective
- 1-2 Ad Sets maximum per campaign (broad targeting)
- 6-20 ads per Ad Set (diverse creative pool)

## Targeting Rules
DO: Use broad targeting (no interests, no lookalikes)
DO: Use Advantage+ audience
DO: Let Andromeda find the audience based on creative signals
DO NOT: Set detailed targeting by interests
DO NOT: Use age/gender restrictions unless legally required
DO NOT: Create multiple lookalike audiences — wastes budget on overlapping auctions

## Campaign Objectives (choose based on goal)
- Lead generation → Leads objective + Instant Forms
- Sales → Sales objective + Advantage+ Shopping Campaign
- Awareness → Reach or Brand Awareness objective
- Traffic → Traffic objective (only if CAPI signals are strong)

## Advantage+ Configuration
- Enable Advantage+ Creative: YES (allows Meta to optimize creative elements)
- Enable Advantage+ Placements: YES (all placements)
- Budget: Campaign Budget Optimization (CBO) preferred over Ad Set Budget
- Bidding: Lowest Cost (default) to start. Switch to Cost Cap only after 50+ conversions

## Budget Rules
Starting budget: Minimum $10/day per ad set to exit learning phase faster
Learning phase exit: ~50 optimization events needed
Do NOT: Reduce budget during learning phase (resets learning)
Do NOT: Edit targeting or creative during first 7 days (resets learning)
Scale trigger: Wait for 50 events + stable CPA before scaling

## CAPI (Conversions API) Requirements
Andromeda quality depends on signal quality. Always configure:
- Pixel + CAPI both firing for the same events
- Priority events: Purchase, Lead, AddToCart, ViewContent
- Event Match Quality score: aim for 7+/10 in Events Manager
- Deduplication: ensure Pixel and CAPI events have matching event_id

## Ad Formats by Placement
Reels: 9:16 vertical, max 60s, hook in first 3 seconds
Stories: 9:16 vertical, max 15s
Feed: 1:1 or 4:5, static or video
Right column: 1:1 only (desktop)

## Meta API version
Always use v19.0 for all Graph API calls related to ads.
Ad Account ID format: act_XXXXXXXXXX
