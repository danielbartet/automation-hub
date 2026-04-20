# Audit Report — Session 2: ClaudeClient

**Date:** 2026-04-19
**File audited:** `backend/app/services/claude/client.py`
**Scope:** Full audit of `ClaudeClient` class — system prompts, error handling, response validation

## Context notes

- The class is named `ClaudeClient`, not `ClaudeService`. Docs/CLAUDE.md reference `ClaudeService`.
- `analyze_campaign()` and `generate_creative_brief()` are NOT methods on `ClaudeClient` — they live in `backend/app/services/ads/optimizer.py:47` and `:266`. Both call `ClaudeClient.generate_content()` internally.

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 4 |
| MEDIUM | 5 |
| LOW | 5 |

## Method Audit Table

| # | Method | Line | System Prompt | Error Handling | Response Validation | Severity |
|---|---|---|---|---|---|---|
| 1 | `generate_carousel_content` | 164 | Delegated | None (delegated) | None (delegated) | MEDIUM |
| 2 | `generate_content_by_type` | 168 | Rich for carousel; thin for story/single_image/text_post | None around `messages.create` / `json.loads` | Infers `narrative_angle`; no key check | HIGH |
| 3 | `generate_content` | 380 | Default `"You are a helpful assistant."` | None | Assumes non-empty `response.content[0]` | HIGH |
| 4 | `generate_content_recommendation` | 396 | Partial (6 Angles + 4U; missing PAS/AIDA/FAB) | Narrow try/except on `json.loads` only | No key validation on recommendation dict | MEDIUM |
| 5 | `generate_caption` | 606 | None (falls to default) | None | No length or empty-string check | HIGH |
| 6 | `generate_ad_concepts` | 611 | Rich (Andromeda rules) | None | `_validate_entity_diversity` only | HIGH |
| 7 | `_validate_entity_diversity` | 782 | N/A | N/A | Similarity only, no required-key check | LOW |
| 8 | `analyze_competitor_ads` | 833 | Rich | Has `except Exception` + `default_analysis` | Index-map reconstruction; `inferred_objective` not validated | MEDIUM |
| 9 | `research_competitors_by_name` | 930 | Rich (Spanish) | `except Exception` references undefined `logger` | Trusts list shape | CRITICAL |
| 10 | `adapt_competitor_ad` | 1024 | Rich | None | Validates `objective` only | MEDIUM |
| 11 | Format prompt builders (`_build_single_image_system_prompt`, `_build_story_system_prompt`, `_build_text_post_system_prompt`) | 261, 301, 341 | Thin — no PAS/AIDA/FAB/Cialdini | N/A | N/A | MEDIUM |

## CRITICAL

### C1. `research_competitors_by_name` — undefined `logger` in except block
**File:** `backend/app/services/claude/client.py:1021`
**Severity:** CRITICAL

**Current code:**
```python
            return cleaned
        except Exception as e:
            logger.warning("research_competitors_by_name failed: %s", e)
            return []
```

**Issue:** `logger` is never imported in this file (no `import logging` at the top). When this except block fires, Python raises `NameError: name 'logger' is not defined` instead of returning `[]`. The fallback is effectively a second uncaught exception.

**Recommended fix:**
```python
# At top of file, add:
import logging
logger = logging.getLogger(__name__)
```

## HIGH

### H1. `generate_caption()` — no system prompt, no error handling, no validation
**File:** `backend/app/services/claude/client.py:606`
**Severity:** HIGH

**Current code:**
```python
    async def generate_caption(self, topic: str, tone: str, language: str = "es") -> str:
        """Generate a social media caption for a topic."""
        prompt = f"Write a social media caption about '{topic}' in {language} with {tone} tone. Max 200 characters."
        return await self.generate_content(prompt)
```

**Issue:** Called from `content.py:552` and `content_generation/skill.py:39` on the primary content publishing path. Passes no system prompt — falls through to `"You are a helpful assistant."` in `generate_content`. Ships a generic caption with zero framework grounding. No validation that caption is non-empty or within 200 chars.

**Recommended fix:**
```python
async def generate_caption(self, topic: str, tone: str, language: str = "es") -> str:
    system_prompt = self._build_caption_system_prompt(tone, language)
    prompt = f"Write a social media caption about '{topic}'. Max 200 characters."
    caption = await self.generate_content(prompt, system_prompt=system_prompt)
    caption = caption.strip()
    if not caption:
        raise ValueError("Empty caption from Claude")
    return caption[:200]
```

### H2. `generate_content()` — default "You are a helpful assistant.", no error handling
**File:** `backend/app/services/claude/client.py:380`
**Severity:** HIGH

**Current code:**
```python
    async def generate_content(self, prompt: str, system_prompt: str = "") -> str:
        """Generate text content — generic helper."""
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=1000,
            system=system_prompt or "You are a helpful assistant.",
            messages=[{"role": "user", "content": prompt}],
        )
        self._last_usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read_tokens": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            "model": self.MODEL,
        }
        return response.content[0].text
```

**Issue:** Used by `optimizer.generate_creative_brief` (L124), `optimizer.analyze_campaign` (L387), and `campaign_chat.py:229`. Fallback prompt is generic. No try/except — an Anthropic outage 500s three features simultaneously. `return response.content[0].text` raises `IndexError` on empty content.

**Recommended fix:**
```python
import anthropic

async def generate_content(self, prompt: str, system_prompt: str = "") -> str:
    try:
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=1000,
            system=system_prompt or DEFAULT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
    except (anthropic.RateLimitError, anthropic.APIConnectionError) as e:
        logger.warning("Claude API transient error: %s", e)
        raise ClaudeServiceError("Claude API unavailable") from e
    except anthropic.APIError as e:
        logger.error("Claude API error: %s", e)
        raise ClaudeServiceError(str(e)) from e
    if not response.content:
        raise ClaudeServiceError("Empty response from Claude")
    return response.content[0].text
```

### H3. `generate_ad_concepts` — no try/except, weak response validation
**File:** `backend/app/services/claude/client.py:611` (API call at ~744, JSON parse at ~776)
**Severity:** HIGH

**Current code:**
```python
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=4000,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": f"Generate {count} ad concepts for {brand_name} following the Andromeda rules exactly.",
                }
            ],
            extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
        )
        self._last_usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read_tokens": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            "model": self.MODEL,
        }

        content = response.content[0].text.strip()
        # Strip markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.rsplit("```", 1)[0].strip()
        result = json.loads(content)
        concepts = result.get("concepts", [])
        concepts = self._validate_entity_diversity(concepts)
        result["concepts"] = concepts
        return result
```

**Issue:** `self.client.messages.create(...)` at line ~744 has no try/except. `json.loads(content)` at line ~776 raises `JSONDecodeError` on malformed output. `_validate_entity_diversity` only checks similarity — doesn't verify required keys (`persona`, `desire`, `awareness`, `psychological_angle`, `hook_3s`, `body`, `cta`, `format`, `visual_style`, `entity_id_risk`).

**Recommended fix:** Wrap in try/except and add a Pydantic model for the response:
```python
class AdConcept(BaseModel):
    persona: str
    desire: str
    awareness: str
    psychological_angle: str
    hook_3s: str
    body: str
    cta: str
    format: str
    visual_style: str
    entity_id_risk: str

class AdConceptsResponse(BaseModel):
    concepts: list[AdConcept]
    diversity_audit: dict
```

### H4. `generate_content_by_type` — no try/except, thin prompts for non-carousel formats
**File:** `backend/app/services/claude/client.py:168` (API call at ~218, JSON parse at ~250)
**Severity:** HIGH

**Current code:**
```python
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=1000,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": user_msg,
                }
            ],
            extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
        )
        self._last_usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read_tokens": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            "model": self.MODEL,
        }

        content = response.content[0].text.strip()
        # Strip markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.rsplit("```", 1)[0].strip()
        result = json.loads(content)

        # Extract or infer the narrative angle and attach it to the response dict
        raw_angle = result.get("narrative_angle", "")
        if raw_angle in VALID_ANGLES:
            result["narrative_angle"] = raw_angle
        else:
            result["narrative_angle"] = _detect_angle_from_content(result)

        return result
```

**Issue:** Raw `messages.create` at line ~218 uncovered. `json.loads` at line ~250 can raise. `content_type` argument not validated against the declared `VALID_FORMATS` tuple on line 6 (which is unused). Carousel prompt (in `_build_system_prompt`) is rich, but `_build_single_image_system_prompt` (L261), `_build_story_system_prompt` (L301), and `_build_text_post_system_prompt` (L341) have no PAS/AIDA/FAB/Cialdini references — `text_post` has zero framework references at all.

**Recommended fix:** Validate `content_type` against `VALID_FORMATS`, wrap API call, lift shared framework content into a `_build_base_principles()` helper called from all four prompt builders.

## MEDIUM

### M1. `generate_content_recommendation` — partial system prompt, narrow error handling
**File:** `backend/app/services/claude/client.py:396` (prompt at ~460-487, API call at ~559, parse at ~578-604)
**Severity:** MEDIUM

**Current code:**
```python
        # Use direct API call with enough tokens for the full JSON response
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=2000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        self._last_usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read_tokens": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            "model": self.MODEL,
        }
        response_text = response.content[0].text

        # Strip markdown code blocks if present
        response_text = re.sub(r'^```(?:json)?\s*', '', response_text.strip())
        response_text = re.sub(r'\s*```$', '', response_text.strip())

        # Try direct parse; if it fails, sanitize newlines inside strings then retry
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            # Replace literal newlines inside JSON string values (between quotes)
            # This handles the case where Claude puts \n in string content
            def fix_newlines_in_strings(s: str) -> str:
                result = []
                in_string = False
                escape_next = False
                for ch in s:
                    if escape_next:
                        result.append(ch)
                        escape_next = False
                    elif ch == '\\' and in_string:
                        result.append(ch)
                        escape_next = True
                    elif ch == '"':
                        in_string = not in_string
                        result.append(ch)
                    elif ch in ('\n', '\r', '\t') and in_string:
                        result.append(' ')
                    else:
                        result.append(ch)
                return ''.join(result)

            cleaned = fix_newlines_in_strings(response_text)
            return json.loads(cleaned)
```

**Issue:** Prompt references 6 Narrative Angles + 4U but missing PAS/AIDA/FAB/BAB/Cialdini audience-temperature decision logic that already exists in `_build_system_prompt` at lines 72-77. Try/except covers only `json.loads` — no Anthropic error handling. No key validation on the returned recommendation dict.

**Recommended fix:** Extract framework library into shared helper; wrap `messages.create` in typed exception handler; add Pydantic `RecommendationResponse` model.

### M2. `generate_carousel_content` — no error handling, no validation (via delegation)
**File:** `backend/app/services/claude/client.py:164`
**Severity:** MEDIUM

**Current code:**
```python
    async def generate_carousel_content(self, project) -> dict:
        """Generate carousel content for a project using Claude."""
        return await self.generate_content_by_type(project, content_type="carousel_6_slides")
```

**Issue:** One-line delegator. Inherits all gaps from `generate_content_by_type` (no try/except, no slide-count validation, no key checks).

**Recommended fix:** Fix upstream in `generate_content_by_type` — this will inherit the fix.

### M3. `adapt_competitor_ad` — no try/except, partial validation
**File:** `backend/app/services/claude/client.py:1024` (API call at ~1073, parse at ~1090)
**Severity:** MEDIUM

**Current code:**
```python
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=500,
            messages=[
                {
                    "role": "user",
                    "content": f"Adapt this competitor ad for {brand_name}:\n{competitor_payload}",
                }
            ],
            system=system_prompt,
        )
        content = response.content[0].text.strip()
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.rsplit("```", 1)[0].strip()
        result = json.loads(content)
        if result.get("objective") not in valid_objectives:
            result["objective"] = "OUTCOME_LEADS"
        return result
```

**Issue:** `messages.create` and `json.loads` uncovered by try/except. Validates `objective` against `valid_objectives` set (good) but not `campaign_name`, `ad_copy` (max 125), `headline` (max 40), `rationale` — length limits promised in prompt but not enforced on output.

**Recommended fix:** Wrap in try/except; add length truncation + key checks on parsed result.

### M4. `analyze_competitor_ads` — bare `except Exception` hides programming errors
**File:** `backend/app/services/claude/client.py:833` (except at ~927)
**Severity:** MEDIUM

**Current code:**
```python
            for i in range(len(ads)):
                if i in index_map:
                    result.append(index_map[i])
                elif i < len(analyses):
                    item = analyses[i]
                    item["index"] = i
                    result.append(item)
                else:
                    result.append(default_analysis(i))
            return result
        except Exception:
            return [default_analysis(i) for i in range(len(ads))]
```

**Issue:** Best-structured method (has `default_analysis` fallback) but the `except Exception` at line 927 swallows `NameError`, `KeyError`, etc. — hiding bugs like C1 behind the fallback. `inferred_objective` declared in prompt but not validated on output.

**Recommended fix:** Replace `except Exception` with `except (anthropic.APIError, json.JSONDecodeError) as e:`.

### M5. Thin format-specific system prompts (story, single_image, text_post)
**File:** `backend/app/services/claude/client.py:261, 301, 341`
**Severity:** MEDIUM

**Current code:**
```python
    def _build_text_post_system_prompt(self, project) -> str:
        config = project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        tone = config.get("tone", "professional, clear")
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "general audience")
        language = config.get("language", "en")
        additional_rules = config.get("additional_rules", [])
        rules_text = "\n".join([f"- {rule}" for rule in additional_rules]) if additional_rules else ""

        return f"""You are the content generation system for {brand_name}.

BRAND POSITIONING:
- Brand name: {brand_name}
- Core message: {core_message}
- Target audience: {target_audience}

TONE:
{tone}

{f"ADDITIONAL RULES:{chr(10)}{rules_text}" if rules_text else ""}

OUTPUT FORMAT:
Always respond with a valid JSON object and nothing else:
{{
  "format": "text_post",
  "category": "string (topic category)",
  "topic": "string (specific topic of this post)",
  "title": "max 12 words — attention-grabbing opener",
  "body": "2-3 short paragraphs, max 300 chars total",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}}

RULES:
- Always return valid JSON, nothing else before or after
- Generate ALL content in: {language}
- Body must have one clear takeaway per paragraph
- Never use generic or cliché phrases"""
```

**Issue:** `_build_text_post_system_prompt` has zero marketing framework references — no PAS/AIDA/FAB/BAB, no Cialdini, no 4U hook rule. Story and single-image are slightly better but still missing framework selection logic.

**Recommended fix:** Extract shared `_build_base_principles()` from `_build_system_prompt` (L72-77) and compose into all four format-specific builders.

## LOW

### L1. `content_type` arg not validated against `VALID_FORMATS`
**File:** `backend/app/services/claude/client.py:168`
**Severity:** LOW

**Current code:**
```python
    async def generate_content_by_type(
        self,
        project,
        content_type: str = "carousel_6_slides",
        category: str | None = None,
        hint: str | None = None,
        competitor_ads: list[dict] | None = None,
    ) -> dict:
        """Generate content for a project based on content_type.

        Supports: carousel_6_slides | single_image | story_vertical | story | text_post
        Optional category and hint are injected into the user message when provided.
        competitor_ads: optional list of competitor ad dicts — injected as context when present.
        """
        if content_type in ("story", "story_vertical"):
```

**Issue:** `VALID_FORMATS` declared at line 6 but never referenced in this method. Unknown `content_type` silently falls through to the carousel path.

**Recommended fix:**
```python
if content_type not in VALID_FORMATS:
    raise ValueError(f"Invalid content_type: {content_type}. Must be one of {VALID_FORMATS}")
```

### L2. `generate_ad_concepts` response missing key checks
**File:** `backend/app/services/claude/client.py:777`
**Severity:** LOW

**Current code:**
```python
        result = json.loads(content)
        concepts = result.get("concepts", [])
        concepts = self._validate_entity_diversity(concepts)
        result["concepts"] = concepts
        return result
```

**Issue:** `concepts = result.get("concepts", [])` silently returns empty list if Claude returns malformed payload. No check that `diversity_audit` key exists.

**Recommended fix:** Raise `ClaudeServiceError` if required keys missing, or covered by H3 Pydantic model.

### L3. `generate_content` assumes non-empty content array
**File:** `backend/app/services/claude/client.py:394`
**Severity:** LOW

**Current code:**
```python
        self._last_usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read_tokens": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            "model": self.MODEL,
        }
        return response.content[0].text
```

**Issue:** `response.content[0].text` raises `IndexError` if Claude returns empty content. No length check, no empty-string guard.

**Recommended fix:** Covered by H2 (guard `if not response.content`).

### L4. Class name drift — `ClaudeClient` vs docs' `ClaudeService`
**File:** `backend/app/services/claude/client.py:48`
**Severity:** LOW

**Current code:**
```python
class ClaudeClient:
    """Wrapper for Anthropic Claude API calls."""

    MODEL = "claude-sonnet-4-6"

    def __init__(self) -> None:
        self.client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        self._last_usage: dict = {}
```

**Issue:** Project CLAUDE.md references `ClaudeService reads project.content_config → builds system prompt` but the actual class is `ClaudeClient`. Minor documentation drift.

**Recommended fix:** Either rename class to `ClaudeService` (and update all imports) OR update CLAUDE.md to reference `ClaudeClient`. Prefer updating docs — less risk.

### L5. `research_competitors_by_name` — bare `except Exception`
**File:** `backend/app/services/claude/client.py:1020`
**Severity:** LOW

**Current code:**
```python
            return cleaned
        except Exception as e:
            logger.warning("research_competitors_by_name failed: %s", e)
            return []
```

**Issue:** Same issue as M4. Also: once C1 is fixed with a proper `logger`, the bare `except` still hides API errors behind the empty-list fallback.

**Recommended fix:** Narrow to `except (anthropic.APIError, json.JSONDecodeError) as e:`.

## Appendix: Other public methods found

- `generate_content_by_type()` (L168) — real workhorse behind `generate_carousel_content`
- `analyze_competitor_ads()` (L833) — Meta Ad Library analysis
- `research_competitors_by_name()` (L930) — fallback when Ad Library empty (C1 bug)
- `adapt_competitor_ad()` (L1024) — generates concept from competitor ad
- Module utilities: `_detect_angle_from_content()` (L11), `compute_cost()` (L43), constants `VALID_FORMATS`/`VALID_ANGLES` (L6-8), `MODEL_PRICING` (L38)

## Appendix: Priority fix order

1. C1 — fix `logger` NameError (2-line change)
2. H1 — enrich `generate_caption` (primary content path)
3. H2 — wrap `generate_content` in try/except (fans out to 3 features)
4. H3, H4 — add Pydantic validation to `generate_ad_concepts` and `generate_content_by_type`
5. M5 — lift shared framework library into base-principles helper; enrich thin prompts
6. M1 — enrich `generate_content_recommendation` prompt with PAS/AIDA/FAB
7. M3, M4 — wrap remaining `messages.create` calls; narrow bare excepts
8. L1 — validate `content_type` against `VALID_FORMATS`
9. L4 — resolve class-name drift (update CLAUDE.md)
