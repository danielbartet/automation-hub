# Audit Report — Session 3: Meta API Response Handling

**Date:** 2026-04-19
**Scope:** All of `backend/app/` — follow-up to commit 89a4bd5 which fixed KeyError: 'value' in ads.py:929 but only patched 5 of the affected comprehensions

## Context

Commit 89a4bd5 fixed `KeyError: 'value'` in 5 comprehensions in `ads.py` (lines 796, 797, 798, 929, 930) by adding `if "value" in a` filters. This audit checks whether the same unsafe pattern exists elsewhere and surveys other unsafe Meta API response handling: dict[key] vs dict.get(key), unsafe list indexing, and numeric coercion on Meta's string/None-prone fields.

## Summary

| Severity | Count |
|---|---|
| HIGH | 3 |
| MEDIUM | 9 |
| LOW | 5 |

| Category | Count |
|---|---|
| 1 — Direct dict access on Meta API responses | 11 |
| 2 — Missing guards on nested .get() | 0 |
| 3 — Unsafe list index | 3 |
| 4 — String/numeric coercion | 3 |

## HIGH

### H1. Dashboard KPI comprehensions replicate 89a4bd5 bug
**File:** `backend/app/api/v1/dashboard.py:35-36`
**Severity:** HIGH
**Category:** 1

**Current code:**
```python
def build_kpis(objective: str, insights: dict) -> dict:
    actions = {a["action_type"]: float(a["value"]) for a in insights.get("actions", [])}
    cpa_dict = {a["action_type"]: float(a["value"]) for a in insights.get("cost_per_action_type", [])}

    base = {
        "spend": float(insights.get("spend", 0)),
        "impressions": int(insights.get("impressions", 0)),
        "reach": int(insights.get("reach", 0)),
```

**Why it breaks:** Both comprehensions access `a["value"]` with no guard. `insights.get("actions", [])` and `insights.get("cost_per_action_type", [])` from Meta can contain action objects without a `value` field. `build_kpis()` runs for every campaign on every dashboard load — a single malformed action crashes the KPI endpoint.

**Recommended fix:**
```python
actions = {a["action_type"]: float(a["value"]) for a in insights.get("actions", []) if "action_type" in a and "value" in a}
cpa_dict = {a["action_type"]: float(a["value"]) for a in insights.get("cost_per_action_type", []) if "action_type" in a and "value" in a}
```

### H2. Campaign chat actions map — missing value guard
**File:** `backend/app/services/ads/campaign_chat.py:98`
**Severity:** HIGH
**Category:** 1

**Current code:**
```python
        # Extract action-based KPIs
        actions_list = metrics.get("actions", [])
        actions = {}
        if isinstance(actions_list, list):
            actions = {a["action_type"]: float(a["value"]) for a in actions_list if "action_type" in a}

        cost_per_action = metrics.get("cost_per_action_type", [])
```

**Why it breaks:** Guards `action_type` but not `value`. Same failure mode as H1. Crashes AI chat for any project with a malformed action.

**Recommended fix:**
```python
actions = {a["action_type"]: float(a["value"]) for a in actions_list if "action_type" in a and "value" in a}
```

### H3. Campaign chat CPA map — missing value guard
**File:** `backend/app/services/ads/campaign_chat.py:103`
**Severity:** HIGH
**Category:** 1

**Current code:**
```python
        cost_per_action = metrics.get("cost_per_action_type", [])
        cpa_map = {}
        if isinstance(cost_per_action, list):
            cpa_map = {a["action_type"]: float(a["value"]) for a in cost_per_action if "action_type" in a}

        leads = actions.get("lead", 0)
        cpl = cpa_map.get("lead", 0)
        purchases = sum(v for k, v in actions.items() if "purchase" in k.lower())
```

**Why it breaks:** Same as H2 for `cost_per_action_type`. Extra prone to missing `value` when Meta has not yet computed CPA for an action type.

**Recommended fix:**
```python
cpa_map = {a["action_type"]: float(a["value"]) for a in cost_per_action if "action_type" in a and "value" in a}
```

## MEDIUM

### M1. Image-upload response — unguarded inner dict access
**File:** `backend/app/api/v1/ads.py:1307-1308`
**Severity:** MEDIUM
**Category:** 1

**Current code:**
```python
            images_block = upload_data.get("images", {})
            first_key = next(iter(images_block), None)
            if not first_key:
                raise HTTPException(502, "Meta API returned no image data")
            new_hash = images_block[first_key]["hash"]
            new_url = images_block[first_key]["url"]

            # 2. Fetch current creative
```

**Why it breaks:** Outer key is checked at line 1305 but inner dict is not — Meta has returned image entries without `url` (videos, async-processing uploads).

**Recommended fix:**
```python
image_data = images_block[first_key] or {}
new_hash = image_data.get("hash")
new_url = image_data.get("url")
if not new_hash:
    raise HTTPException(502, "Meta API returned an image upload result without a hash")
```

### M2. create_creative — direct id access
**File:** `backend/app/api/v1/ads.py:1227`
**Severity:** MEDIUM
**Category:** 1

**Current code:**
```python
            new_creative_data = new_creative_resp.json()
            if "error" in new_creative_data:
                raise HTTPException(502, f"Meta API error creating creative: {new_creative_data['error'].get('message', 'unknown')}")

            new_creative_id = new_creative_data["id"]

            # 4. Swap creative on the ad
            swap_resp = await client.post(
```

**Why it breaks:** `"error" in new_creative_data` is checked but Meta 2xx responses with warning envelopes sometimes omit `id`.

**Recommended fix:**
```python
new_creative_id = new_creative_data.get("id")
if not new_creative_id:
    raise HTTPException(502, "Meta API returned no creative id")
```

### M3. Import loop — direct id access
**File:** `backend/app/api/v1/ads.py:1450`
**Severity:** MEDIUM
**Category:** 1

**Current code:**
```python
    today = datetime.utcnow().date()

    for mc in meta_campaigns:
        meta_id = mc["id"]
        meta_status_raw = mc.get("status", "PAUSED").upper()
        status = "active" if meta_status_raw == "ACTIVE" else "paused"
        name = mc.get("name", "")
        objective = mc.get("objective")
```

**Why it breaks:** One malformed campaign entry kills the whole import loop.

**Recommended fix:**
```python
for mc in meta_campaigns:
    meta_id = mc.get("id")
    if not meta_id:
        continue
```

### M4. Per-ad creative fetch — direct id access
**File:** `backend/app/api/v1/ads.py:1105`
**Severity:** MEDIUM
**Category:** 1

**Current code:**
```python
            # 2. For each ad, fetch creative details
            output = []
            for ad in raw_ads:
                ad_id = ad["id"]
                creative_resp = await client.get(
                    f"{META_BASE}/{ad_id}",
                    params={
                        "fields": "id,name,creative{id,object_story_spec,image_url,thumbnail_url}",
```

**Why it breaks:** One malformed ad entry fails the whole list render endpoint.

**Recommended fix:**
```python
for ad in raw_ads:
    ad_id = ad.get("id")
    if not ad_id:
        continue
```

### M5. Attribution diagnostic — direct id access
**File:** `backend/app/api/v1/ads.py:2092`
**Severity:** MEDIUM
**Category:** 1

**Current code:**
```python
                "attribution_spec": test_campaign.get("attribution_spec"),
            }

            meta_campaign_id = test_campaign["id"]

            # 3a. Insights WITHOUT explicit attribution window (Meta uses account default)
            ins_default_resp = await client.get(
                f"{META_BASE}/{meta_campaign_id}/insights",
```

**Why it breaks:** Diagnostic endpoint crashes with 500 instead of returning a useful diagnostic.

**Recommended fix:**
```python
meta_campaign_id = test_campaign.get("id")
if not meta_campaign_id:
    result["notes"].append("First campaign has no id; cannot run attribution diagnostic")
else:
    # ... existing insights calls
```

### M6. image_crops unguarded inner list index
**File:** `backend/app/api/v1/ads.py:1132`
**Severity:** MEDIUM
**Category:** 3

**Current code:**
```python
                # Extract image_url: try multiple fallback paths
                image_url = (
                    creative.get("image_url")
                    or creative.get("thumbnail_url")
                    or link_data.get("picture")
                    or (list((link_data.get("image_crops") or {}).values())[0][0].get("url")
                        if link_data.get("image_crops") else None)
                    or None
                )
```

**Why it breaks:** Guards outer dict but not inner list length. `{"400x400": []}` (seen during async processing) raises `IndexError`.

**Recommended fix:**
```python
image_url = None
crops = link_data.get("image_crops") or {}
for crop_list in crops.values():
    if isinstance(crop_list, list) and crop_list:
        first = crop_list[0]
        if isinstance(first, dict) and first.get("url"):
            image_url = first["url"]
            break
```

### M7. purchase_roas float coercion may fail on empty string
**File:** `backend/app/api/v1/ads.py:875`
**Severity:** MEDIUM
**Category:** 4

**Current code:**
```python
                float(r.get("value", 0))
                for r in purchase_roas_data
                if r.get("action_type") in PURCHASE_ACTION_TYPES
            ]
            roas = roas_values[0] if roas_values else (
                float(purchase_roas_data[0].get("value", 0)) if purchase_roas_data else None
            )
```

**Why it breaks:** `float("")` raises `ValueError`. Meta returns `"value": ""` for ROAS on campaigns with spend but no conversions.

**Recommended fix:**
```python
def _to_float(v, default=None):
    try:
        return float(v) if v not in (None, "") else default
    except (TypeError, ValueError):
        return default

roas = roas_values[0] if roas_values else (
    _to_float(purchase_roas_data[0].get("value"), None) if purchase_roas_data else None
)
```

### M8. OAuth response — direct access_token access
**File:** `backend/app/services/meta_oauth.py:139` and `:171`
**Severity:** MEDIUM
**Category:** 1

**Current code (around 139):**
```python
    if not resp.is_success:
        logger.error("Meta token exchange failed %s: %s", resp.status_code, resp.text)
        raise RuntimeError(f"Meta token exchange failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    return data["access_token"]
```

**Current code (around 171):**
```python
    if not resp.is_success:
        logger.error("Meta token upgrade failed %s: %s", resp.status_code, resp.text)
        raise RuntimeError(f"Meta token upgrade failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    long_lived_token = data["access_token"]
    expires_at = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 5184000))  # default 60 days
    return long_lived_token, expires_at
```

**Why it breaks:** Meta can return 200 OK with JSON body lacking `access_token` in rare cases. Would raise `KeyError` leaking a stack trace.

**Recommended fix:**
```python
data = resp.json()
token = data.get("access_token")
if not token:
    raise RuntimeError(f"Meta token response missing access_token: {data}")
return token
```

### M9. campaign_chat purchase_roas coercion
**File:** `backend/app/services/ads/campaign_chat.py:117`
**Severity:** MEDIUM
**Category:** 4

**Current code:**
```python
        # a wildly different number than what the optimizer reports.
        purchase_roas_list = metrics.get("purchase_roas", [])
        if isinstance(purchase_roas_list, list) and purchase_roas_list:
            roas = float(purchase_roas_list[0].get("value", 0) or 0)
        else:
            roas = 0.0
```

**Why it breaks:** `or 0` handles empty string but `float()` still fails on non-numeric sentinel strings.

**Recommended fix:**
```python
raw_val = purchase_roas_list[0].get("value")
try:
    roas = float(raw_val) if raw_val not in (None, "") else 0.0
except (TypeError, ValueError):
    roas = 0.0
```

## LOW

### L1. action_values float coercion — presence guarded but no type safety
**File:** `backend/app/api/v1/ads.py:796, 797, 798, 929, 930, 2106, 2121`
**Severity:** LOW
**Category:** 4

**Current code (example, line 797):**
```python
    # Build insights summary
    actions = {a["action_type"]: float(a["value"]) for a in insights_summary_raw.get("actions", []) if "value" in a}
    action_values = {a["action_type"]: float(a["value"]) for a in insights_summary_raw.get("action_values", []) if "value" in a}
    cpa_dict = {a["action_type"]: float(a["value"]) for a in insights_summary_raw.get("cost_per_action_type", []) if "value" in a}
    objective = (campaign_info.get("objective") or (campaign.objective if campaign else None) or "").upper()

    total_spend = float(insights_summary_raw.get("spend", 0))
```

**Why it breaks:** `if "value" in a` prevents KeyError but `float("")` or `float("N/A")` still raises `ValueError`.

**Recommended fix:** Add a helper and use it at all listed lines:
```python
def _safe_float(v, default=0.0):
    try:
        return float(v) if v not in (None, "") else default
    except (TypeError, ValueError):
        return default

action_values = {a["action_type"]: _safe_float(a.get("value")) for a in insights_summary_raw.get("action_values", []) if a.get("action_type")}
```

### L2. OAuth Instagram account list — [0]["id"] access
**File:** `backend/app/services/meta_oauth.py:251`
**Severity:** LOW
**Category:** 3

**Current code:**
```python
                "discover_assets: error fetching Instagram account for page %s: %s",
                page_id,
                exc,
            )

    if all_instagram_accounts:
        instagram_account_id = all_instagram_accounts[0]["id"]
    elif facebook_page_id:
```

**Why it breaks:** Safe today (list is built with guaranteed `id` in same module at line 242) but brittle to future refactors.

**Recommended fix:**
```python
if all_instagram_accounts:
    instagram_account_id = all_instagram_accounts[0].get("id")
```

### L3. meta_campaign.py — direct id access after error check
**File:** `backend/app/services/ads/meta_campaign.py:45, 70, 98, 115, 176, 194, 271`
**Severity:** LOW
**Category:** 1

**Current code (example, around line 45):**
```python
            campaign_data = campaign_resp.json()
            if "error" in campaign_data:
                logger.error("Meta campaign creation error: %s", json.dumps(campaign_data["error"]))
                raise ValueError(f"Campaign creation failed: {campaign_data['error']['message']}")
            campaign_id = campaign_data["id"]

            # 2. Create Ad Set (Broad/Andromeda targeting)
            daily_budget_cents = int(daily_budget_dollars * 100)
```

**Why it breaks:** Error branch handled, but 2xx with missing `id` would raise `KeyError`. Unlikely but inconsistent with defensive style elsewhere.

**Recommended fix (apply to all 7 lines):**
```python
new_id = data.get("id")
if not new_id:
    raise RuntimeError(f"Meta API returned no id: {data}")
return new_id
```

### L4. audit.py — event_match_quality_score direct access
**File:** `backend/app/services/ads/audit.py:956`
**Severity:** LOW
**Category:** 1

**Current code:**
```python
            threshold_value="≥ 8.0 for PASS, 6.0-7.9 for WARNING",
        )

    best = scored[0]
    score = float(best["event_match_quality_score"])

    if score >= 8.0:
        return CheckResult(
```

**Why it breaks:** Guarded by prior filter that excludes None entries. Safe today but fragile to refactors.

**Recommended fix:**
```python
score = float(best.get("event_match_quality_score") or 0)
```

### L5. audiences.py — failures[0]["message"] direct access
**File:** `backend/app/api/v1/audiences.py:519`
**Severity:** LOW
**Category:** 1

**Current code:**
```python
    # All countries failed → 400
    if not successes:
        if len(failures) == 1:
            detail = failures[0]["message"]
        else:
            lines = "; ".join(f"{f['country']}: {f['message']}" for f in failures)
            detail = f"No se pudo crear ningún lookalike. {lines}"
        raise HTTPException(status_code=400, detail=detail)
```

**Why it breaks:** `failures` is built locally with guaranteed `message` key — safe today but minor defensive improvement.

**Recommended fix:**
```python
detail = failures[0].get("message", "unknown")
```

## Appendix: Priority fix order

1. H1, H2, H3 — identical pattern to the production bug; one-word fix each; high-traffic paths
2. M1–M9 — fold into one defensive-hardening commit
3. L1–L5 — defer to general cleanup; safe today

## Appendix: Files touched

- `backend/app/api/v1/dashboard.py` — H1
- `backend/app/services/ads/campaign_chat.py` — H2, H3, M9
- `backend/app/api/v1/ads.py` — M1, M2, M3, M4, M5, M6, M7, L1
- `backend/app/services/meta_oauth.py` — M8, L2
- `backend/app/services/ads/meta_campaign.py` — L3
- `backend/app/services/ads/audit.py` — L4
- `backend/app/api/v1/audiences.py` — L5

## Appendix: Category 2 finding

No category-2 issues found. The codebase consistently uses the `obj.get("x", {}).get("y")` idiom on Meta response chains. The earlier fix propagated that pattern well.
