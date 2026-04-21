# BRAND_CONFIG — Project `content_config` Schema Reference

This document is the single source of truth for all fields in `Project.content_config` (JSON column).  
Adding a new project = one API call to `POST /api/v1/projects` with the appropriate `content_config`.

---

## Field Reference

| Field | Type | Default | Description | Example |
|---|---|---|---|---|
| `language` | string | `"es"` | Language for all Claude outputs | `"es"` / `"en"` |
| `brand_name` | string | **required** | Brand display name used in prompts and slides | `"Quantoria Labs"` |
| `brand_voice` | string | `"conversational"` | Tone injected into ALL Claude methods. Valid values: `formal`, `conversational`, `bold`, `educational`, `playful` | `"bold"` |
| `brand_primary_color` | string | `"#00FF41"` | Primary accent color for the HTML slide renderer | `"#FF5733"` |
| `brand_bg_color` | string | `"#0a0a0a"` | Background color for the HTML slide renderer | `"#1a1a2e"` |
| `market_region` | string | `"Global"` | Market context injected into Claude carousel/content prompts. Valid: `LATAM`, `North America`, `Europe`, `Global` | `"LATAM"` |
| `target_countries` | array[string] | `[]` | ISO-3166-1 alpha-2 country codes for Meta ad targeting defaults | `["AR", "MX", "CO"]` |
| `posting_timezone` | string | `"UTC"` | Timezone for calendar display and content scheduling (IANA format) | `"America/Argentina/Buenos_Aires"` |
| `target_audience` | string | **required** | Who they are, their fears, goals, and context | `"Developers 25-35 who want to earn more in USD without leaving LATAM"` |
| `core_message` | string | **required** | Single most important brand message — the north star for all content | `"Aprende. Construye. Escala."` |
| `tone` | string | `"professional, clear"` | Legacy tone field. Prefer `brand_voice`. Appended to system prompts alongside voice instruction | `"direct, conversational, avoid corporate tone"` |
| `content_categories` | array[string] | `[]` | Content types to rotate between. Passed verbatim to Claude — keep specific | `["tutorials", "case_studies", "controversial_takes", "success_stories"]` |
| `website_url` | string | `null` | Canonical brand URL. Pre-fills campaign destination URL in CreateCampaignModal | `"https://quantorialabs.com"` |
| `competitors` | array[object] or array[string] | `[]` | Competitor page handles for Apify scraping and Meta Ad Library lookups. Object form adds metadata | `[{"handle": "midudev", "industry": "tech_edu", "tags": ["youtube", "latam"]}]` |
| `optimizer_config` | object | see defaults | Andromeda optimizer thresholds. All keys optional — unset keys fall back to global defaults | `{"cpl_threshold": 5.0, "roas_threshold": 2.0, "cpc_threshold": 0.30, "min_days": 7, "min_spend": 50.0, "max_budget_multiplier": 1.3}` |
| `output_format` | string | `"carousel_6_slides"` | Default content output type | `"carousel_6_slides"` |
| `slide_count` | integer | `6` | Default number of carousel slides (3–10). Overridable per-request via `num_slides` param | `6` |
| `additional_rules` | array[string] | `[]` | Extra instructions appended verbatim to all Claude carousel/content prompts | `["Always end with a question", "Use LATAM slang", "Reference Colombian cities when possible"]` |
| `price_range` | string | `""` | Product price information. Injected as "Precio" into BRAND ASSETS block | `"$29/mes o $199/año"` |
| `social_proof_examples` | string | `""` | Concrete social proof. Injected as "Prueba social" into BRAND ASSETS block | `"3.200 estudiantes, 4.8⭐ promedio, alumni en Google y MercadoLibre"` |
| `offer` | string | `""` | Current promotion or offer. Injected as "Oferta actual" into BRAND ASSETS block | `"50% OFF el primer mes con código LATAM50"` |
| `business_objective` | string | `""` | Top-level business goal. Used in `generate_content_recommendation` | `"Generar leads para el curso de arquitectura cloud"` |
| `posting_frequency` | string | `""` | Posting cadence hint for the recommendation engine | `"3-4 veces por semana"` |
| `ad_library_countries` | array[string] | `["AR", "MX", "CO", "CL"]` | Country scope for Meta Ad Library competitor searches | `["ES", "MX", "AR"]` |
| `font_urls` | array[string] | `[]` | External font URLs injected as `@font-face` blocks in the HTML slide renderer. When provided, the custom font is used as primary with Space Grotesk as fallback | `["https://fonts.gstatic.com/s/myfont/v1/myfont.woff2"]` |
| `font_family` | string | `"CustomFont"` | Font family name used in `@font-face` declarations when `font_urls` is set | `"Playfair Display"` |
| `rtl` | boolean | `false` | Set to `true` for Arabic, Hebrew, or other RTL languages. Adds `dir="rtl"` to the HTML root and `direction: rtl; text-align: right;` to the body CSS in all slide renderer layouts | `true` |

---

## `brand_voice` Values

| Value | Effect |
|---|---|
| `formal` | Precise, authoritative language. Avoid contractions. Third-person brand references. |
| `conversational` | Warm, friendly, direct. Use "you". Approachable. *(default)* |
| `bold` | Direct and provocative. Short sentences. Strong statements. Never hedge. |
| `educational` | Clear explanations. Analogies, examples, breaking down complexity. |
| `playful` | Light tone, humor welcome. No corporate language. Emojis acceptable. |

---

## `optimizer_config` Defaults

```json
{
  "min_days": 7,
  "min_spend": 50.0,
  "max_budget_multiplier": 1.3,
  "target_cpl": 5.0,
  "target_roas": 2.0,
  "target_cpc": 0.30
}
```

---

## How Fields Are Used

| Claude Method | Fields Read |
|---|---|
| `_build_system_prompt` (carousel) | `brand_name`, `brand_voice`, `tone`, `core_message`, `target_audience`, `content_categories`, `language`, `additional_rules`, `market_region`, `price_range`, `social_proof_examples`, `offer`, `slide_count` |
| `_build_single_image_system_prompt` | `brand_name`, `brand_voice`, `tone`, `core_message`, `target_audience`, `content_categories`, `language`, `price_range`, `social_proof_examples`, `offer` |
| `_build_story_system_prompt` | `brand_name`, `brand_voice`, `tone`, `core_message`, `target_audience`, `content_categories`, `language`, `price_range`, `social_proof_examples`, `offer` |
| `_build_text_post_system_prompt` | `brand_name`, `brand_voice`, `tone`, `core_message`, `target_audience`, `content_categories`, `language`, `additional_rules`, `price_range`, `social_proof_examples`, `offer` |
| `generate_ad_concepts` | `brand_name`, `brand_voice`, `core_message` (or `product_description`), `target_audience`, `language`, `price_range`, `social_proof_examples`, `offer` |
| `generate_content_recommendation` | `brand_name`, `brand_voice`, `language`, `core_message`, `target_audience`, `business_objective`, `content_categories`, `posting_frequency`, `posting_timezone` |
| `analyze_competitor_brief` | `market_region`, `target_audience`, `language` |
| `adapt_competitor_ad` | `brand_name`, `core_message`, `target_audience`, `tone`, `language` |
| HTML renderer (slide images) | `brand_primary_color`, `brand_bg_color`, `font_urls`, `font_family`, `rtl` |
| Ads optimizer (Andromeda) | `optimizer_config` (all sub-keys), `language`, `core_message`, `target_audience` |
| Meta Ad Library scraping | `competitors`, `ad_library_countries` |
| Campaign targeting defaults | `target_countries` |

---

## Minimal config (new project)

```json
{
  "language": "es",
  "brand_name": "Acme Corp",
  "brand_voice": "conversational",
  "core_message": "Ayudamos a equipos de ventas a cerrar más deals con menos esfuerzo.",
  "target_audience": "Sales managers 30-45 in Argentina managing teams of 5-20 reps.",
  "content_categories": ["case_studies", "productivity_tips", "sales_frameworks"],
  "market_region": "LATAM",
  "output_format": "carousel_6_slides",
  "slide_count": 6
}
```

## Full config (production example — Quantoria Labs)

```json
{
  "language": "es",
  "brand_name": "Quantoria Labs",
  "brand_voice": "bold",
  "brand_primary_color": "#00FF41",
  "brand_bg_color": "#0a0a0a",
  "market_region": "LATAM",
  "target_countries": ["AR", "MX", "CO", "CL"],
  "posting_timezone": "America/Argentina/Buenos_Aires",
  "tone": "direct, technical but accessible, no corporate BS",
  "core_message": "Aprende cloud. Consigue trabajo remoto. Gana en dólares.",
  "target_audience": "Developers 25-35 in LATAM who want to land remote jobs at foreign companies.",
  "content_categories": ["cloud_tutorials", "job_hunting_tips", "success_stories", "uncomfortable_truths"],
  "website_url": "https://quantorialabs.com",
  "competitors": [
    {"handle": "midudev", "industry": "tech_edu", "tags": ["youtube", "latam"]},
    {"handle": "hola.devs", "industry": "tech_edu", "tags": ["instagram"]}
  ],
  "optimizer_config": {
    "cpl_threshold": 5.0,
    "roas_threshold": 2.0,
    "cpc_threshold": 0.30,
    "min_days": 7,
    "min_spend": 50.0,
    "max_budget_multiplier": 1.3
  },
  "output_format": "carousel_6_slides",
  "slide_count": 6,
  "price_range": "$29/mes o $199/año",
  "social_proof_examples": "3.200 estudiantes, 4.8 estrellas promedio",
  "offer": "Primer mes 50% OFF con código LATAM50",
  "additional_rules": [
    "Always reference a specific tool or technology (AWS, Terraform, Docker)",
    "End with a provocative question about career growth"
  ],
  "business_objective": "Generar leads para el bootcamp de arquitectura cloud",
  "posting_frequency": "4-5 veces por semana"
}
```
