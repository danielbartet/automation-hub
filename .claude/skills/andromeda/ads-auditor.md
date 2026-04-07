---
name: andromeda-ads-auditor
description: "ALWAYS use this skill when reviewing Meta Ads performance. Load it whenever: analyzing campaign metrics, detecting creative fatigue, deciding whether to scale or pause a creative, reviewing CTR drops, or making any budget decision. Do not make ad optimization decisions without this skill."
---

# Andromeda Ads Auditor Skill

## Key Metrics to Monitor
- Hook Rate: % of people who watch past 3 seconds. Benchmark: >25%
- Hold Rate: % of people who watch past 15 seconds. Benchmark: >15%
- Frequency: Average times a person sees the same ad. Max: 3.0
- CTR: Click-through rate. Flag if drops >30% in 7 days
- CPA: Cost per acquisition. Flag if rises while CTR drops
- MER: Marketing Efficiency Ratio (total revenue / total ad spend)

## Fatigue Detection (14-21 day cycle)
Andromeda exhausts optimal audiences in 2-4 weeks. Fatigue signals:
- CPA rising + CTR falling after week 2 → mark creative as FATIGUED
- Hook Rate below account average → hook needs replacement
- Frequency above 3.0 → rotate to new Entity ID immediately
- CTR drops 30% in 7 days → trigger creative rotation

## Decision Rules

If Hook Rate < 25%:
→ Generate new hook for first 3 seconds (keep body of ad if performing)
→ New hook must use a different psychological angle than the original

If Hold Rate < 15%:
→ Body content is not resonating
→ Generate new concept with different P.D.A. combination

If Frequency > 3.0:
→ Rotate to new Entity ID from the PDA concept pool
→ Do not increase budget until frequency drops below 2.0

If CTR drops 30% in 7 days:
→ Pause the fatigued creative
→ Generate replacement concept using opposite psychological angle

If CPA stable AND Hold Rate > 15%:
→ Scale budget 20-50% every 3-4 days
→ Do NOT restart learning phase — incremental increases only

If MER > 3.0 AND Hold Rate > 15%:
→ Aggressive scale: increase budget 20% per day until MER drops below 3.0

## Similarity Audit
If two or more ads share >60% semantic similarity:
→ Pause the duplicate (keep the one with better Hook Rate)
→ Generate a conceptually distinct replacement using a different P.D.A. angle

## Weekly Audit Checklist
1. Pull last 7 days metrics for all active creatives
2. Flag any creative matching fatigue signals above
3. Check frequency per creative
4. Identify top performer (highest Hold Rate + lowest CPA)
5. Generate brief for replacement concepts if any were flagged
6. Report: KEEP / SCALE / ROTATE / PAUSE for each creative

## Output format for audit report
CREATIVE AUDIT — [date]
Campaign: [name]

| Creative | Hook Rate | Hold Rate | Frequency | CTR | CPA | Action |
|---|---|---|---|---|---|---|
| [name] | [%] | [%] | [x] | [%] | [$] | KEEP/SCALE/ROTATE/PAUSE |

Flagged issues: [list]
Recommended new concepts: [number needed]
Budget recommendation: [action]
