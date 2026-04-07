---
name: quantoria-labs-context
description: "ALWAYS load this skill for ANY task related to Quantoria Labs. Load it whenever: generating content in Spanish, creating ads for @quantorialabs, using Meta IDs for this project, or working with Quantoria's brand voice. This skill contains all project-specific IDs, personas, tone guidelines, and content format that must be applied consistently."
---

# Quantoria Labs — Project Context

## Brand Identity
- Name: Quantoria Labs
- Category: Tech education for developers
- Positioning: NOT a traditional academy or personal influencer. A technical laboratory that analyzes professional evolution in the AI era.
- Core message: "AI does not replace developers. It replaces average developers."
- Fundamental rule: "Professional value is no longer how much code you write. It is what systems you know how to design."

## Target Audience
- Age: 22-32 years old
- Experience: 0-5 years as developers
- Context: Work in software, cloud, backend, frontend, devops
- Fear: Being left behind by AI
- Want: Clear path to differentiate themselves
- Problem: Do not know what to learn or how to position themselves

## P.D.A. Personas for Andromeda
Persona 1 — The Anxious Junior
- Desire: Stop feeling replaceable, gain clarity on what to learn
- Awareness: Problem-aware (knows AI is a threat, doesn't know what to do)

Persona 2 — The Stagnant Mid-level
- Desire: Move from executor to designer/architect, get promoted or freelance
- Awareness: Solution-aware (knows they need to change, looking for how)

Persona 3 — The Self-taught Developer
- Desire: Validate their skills, gain credibility without a formal degree
- Awareness: Problem-aware (feels imposter syndrome, fears AI exposure)

## Tone of Voice
- Technical, direct, elegant
- Confrontational but intelligent — challenges comfortable assumptions
- No excessive emojis
- No empty motivational phrases
- No influencer style
- No hype or exaggeration
- Spanish (Latin America) — always

## Content Categories (rotate between these)
1. Strategic confrontation — challenge assumptions developers have about their careers
2. Common junior mistakes — specific technical and professional errors
3. Mental frameworks — structured ways of thinking about career and architecture
4. Actionable micro-checklists — concrete steps developers can take immediately

## Visual Style
- Dark background
- White typography
- Clean, minimalist design
- No human faces
- No stock imagery
- Logo: Quantoria Labs wordmark

## Meta IDs
- Facebook Page ID: 1010286398835015
- Instagram Account ID: 17841449394293930
- Ad Account: act_1337773745049119
- Meta Pixel: 2337199813441200
- System User: n8n-automation (ID: 61580762415010)
- Graph API version: v19.0

## Infrastructure
- n8n webhook: https://n8n.quantorialabs.com/webhook/QHcY6NWupxgAsy3m/webhook/publish-meta
- Telegram approval chat: 1284119239
- Backend API: http://localhost:8000 (local) / https://api.quantorialabs.com (prod)

## Static Assets (S3)
- Bucket: quantoria-static (us-east-1)
- AWS Profile: chatbot-daniel
- Images URL: https://quantoria-static.s3.amazonaws.com/images/
- Videos URL: https://quantoria-static.s3.amazonaws.com/videos/
- Upload command: aws s3 cp file.png s3://quantoria-static/images/file.png --profile chatbot-daniel
- Public URL format: https://quantoria-static.s3.amazonaws.com/images/{filename}

## Content Format
- Carousels: 6 slides (hook + 4 content + close)
- Slide 1: Hook — max 8 words, provocative, stops scrolling
- Slides 2-5: One clear idea per slide, max 40 words
- Slide 6: Close — conclusion or provocative question + CTA (save or follow)
- Caption: 150-200 chars, same tone as slides, ends with question or strong statement
- Hashtags: 5 — mix of niche and broad, relevant not spammy
- Language: Spanish (Latin America) — every single word

## Output JSON format for content generation
{
  "category": "one of 4 categories above",
  "topic": "specific topic of this carousel",
  "slides": [
    {"slide_number": 1, "type": "hook", "headline": "max 8 words", "subtext": "max 20 words"},
    {"slide_number": 2, "type": "content", "headline": "max 6 words", "body": "max 40 words"},
    {"slide_number": 3, "type": "content", "headline": "max 6 words", "body": "max 40 words"},
    {"slide_number": 4, "type": "content", "headline": "max 6 words", "body": "max 40 words"},
    {"slide_number": 5, "type": "content", "headline": "max 6 words", "body": "max 40 words"},
    {"slide_number": 6, "type": "close", "headline": "max 8 words", "cta": "max 15 words"}
  ],
  "caption": "150-200 chars in Spanish",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}
