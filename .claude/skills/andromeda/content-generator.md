---
name: andromeda-content-generator
description: "ALWAYS use this skill when generating ANY content or ad creative for Meta campaigns. Load it whenever: creating carousel copy, writing ad scripts, building creative briefs, or planning content batches. Do not generate Meta ad content without this skill — it contains the Andromeda framework, Entity ID trap rules, and P.D.A. structure that must be applied to every piece of content."
---

# Andromeda Content Generator Skill

## What is Andromeda
Meta's Andromeda is a retrieval system that reads pixels, frames, audio and text to match ads with users' psychological state in real time. It does NOT target by demographic — the creative IS the targeting mechanism.

## Core Rule: Creative = Targeting
Do not rely on audience interests or lookalikes. Use broad targeting and let the creative filter the audience. Andromeda finds the right person based on what the ad communicates.

## The Entity ID Trap (Critical)
Andromeda groups similar ads under a single Entity ID and gives them only ONE auction ticket combined. Variations of color, subtitle or minor copy changes = same Entity ID = wasted budget.

Rule: If two concepts share more than 60% semantic similarity (same angle, similar visuals, redundant narrative), discard the duplicate and regenerate from scratch.

## P.D.A. Framework (required for every concept)
Each concept must define:
- Persona: Who is speaking or being addressed (e.g. overwhelmed professional, skeptical buyer, ambitious beginner)
- Desire: What outcome they want (e.g. save time, gain status, feel secure, avoid risk)
- Awareness: Funnel stage (Problem-aware, Solution-aware, Product-aware)

## 4 Psychological Angles (rotate between all)
1. Logical — data, comparisons, ROI, efficiency arguments
2. Emotional — transformation, relief, aspiration, fear of missing out
3. Social Proof — testimonials, results, UGC style, community
4. Problem/Solution — name the pain explicitly then offer the exit

## Hook Rule (first 3 seconds)
Andromeda evaluates relevance in the first 3 seconds. Every concept needs a disruptive visual or audio hook that is unique from other concepts in the same batch.

## Generation Process
When asked to generate concepts:

Step 1 - Generate N concepts varying P.D.A. dimensions and psychological angles
Step 2 - Audit: compare each concept against the others. Flag any pair with >60% semantic overlap as REJECTED BY REDUNDANCY and replace
Step 3 - Output approved concepts in this format:

CONCEPT [number]:
- Persona: [who]
- Desire: [what outcome]
- Awareness: [funnel stage]
- Angle: [Logical / Emotional / Social Proof / Problem-Solution]
- Hook (0-3s): [exact opening line or visual description]
- Body: [main message, max 3 sentences]
- CTA: [call to action]
- Format: [Reels 9:16 / Feed 1:1 / Feed 4:5]
- Entity ID risk: [LOW / MEDIUM — explain if medium]

Step 4 - Present Diversity Index table showing similarity score between each pair

## Diversity Index Table format
| Concept A | Concept B | Similarity | Status |
|---|---|---|---|
| C1 | C2 | 25% | APPROVED |
| C1 | C3 | 65% | REJECTED — regenerate C3 |

## Batch size recommendation
Minimum 6 concepts per campaign. Optimal: 12-20 for Andromeda to have enough variety to find winners.

## Format guidelines
- Reels / Stories: 9:16 vertical, hook in first 3 seconds
- Feed: 1:1 square or 4:5 portrait
- Text overlay: clear semantic keywords readable in milliseconds
- No face required — abstract, product-focused or text-only all work
