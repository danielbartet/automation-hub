"""Audience management endpoints — Meta custom audiences per project."""
import csv
import hashlib
import io
import json
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_session
from app.core.config import settings
from app.models.audience import Audience
from app.models.project import Project

router = APIRouter()

META_BASE = "https://graph.facebook.com/v19.0"

# Instagram engagement type mapping
_IG_ENGAGEMENT_MAP = {
    "ALL": "ig_business_profile_all",
    "VIDEO_WATCHERS": "ig_business_profile_video_view",
    "POST_SAVERS": "ig_business_profile_save",
    "PROFILE_VISITORS": "ig_business_profile_visit",
}


# ---------------------------------------------------------------------------
# Pydantic request schemas
# ---------------------------------------------------------------------------


class WebsiteAudienceRequest(BaseModel):
    name: str
    retention_days: int  # 7|14|30|60|90|180
    event_type: str  # PageView|Lead|Purchase|ViewContent


class EngagementAudienceRequest(BaseModel):
    name: str
    platform: str  # instagram | facebook
    retention_days: int
    engagement_type: str  # ALL|VIDEO_WATCHERS|POST_SAVERS|PROFILE_VISITORS


class LookalikeAudienceRequest(BaseModel):
    name: str
    source_audience_id: str  # DB id of source audience
    ratio: float  # 0.01|0.02|0.05
    countries: list[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_project(slug: str, db: AsyncSession) -> Project:
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
    return project


def _project_meta_creds(project: Project) -> tuple[str, str]:
    """Return (token, ad_account_id_without_prefix). Raises 400 if missing."""
    token = project.meta_access_token or getattr(settings, "META_ACCESS_TOKEN", "")
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")
    if not token:
        raise HTTPException(status_code=400, detail="Project has no Meta access token configured")
    if not ad_account_id:
        raise HTTPException(status_code=400, detail="Project has no Meta ad account configured")
    return token, ad_account_id


def _audience_to_dict(a: Audience) -> dict:
    return {
        "id": a.id,
        "project_id": a.project_id,
        "meta_audience_id": a.meta_audience_id,
        "name": a.name,
        "type": a.type,
        "subtype": a.subtype,
        "size": a.size,
        "status": a.status,
        "source_audience_id": a.source_audience_id,
        "lookalike_ratio": a.lookalike_ratio,
        "lookalike_countries": a.lookalike_countries,
        "retention_days": a.retention_days,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


async def _meta_get(token: str, path: str, params: dict | None = None) -> dict:
    """Perform a GET request against the Meta Graph API."""
    url = f"{META_BASE}{path}"
    all_params = {"access_token": token}
    if params:
        all_params.update(params)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, params=all_params)
        return resp.json()


async def _meta_post_json(token: str, path: str, payload: dict) -> dict:
    """POST to Meta API as form-encoded. dict/list fields are compact JSON strings."""
    url = f"{META_BASE}{path}"
    form_data: dict[str, str] = {"access_token": token}
    for key, value in payload.items():
        if isinstance(value, (dict, list)):
            form_data[key] = json.dumps(value, separators=(",", ":"))
        else:
            form_data[key] = str(value)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, data=form_data)
        return resp.json()


async def _meta_post_body(token: str, path: str, payload: dict) -> dict:
    """POST to Meta API as JSON body with access_token in query params."""
    url = f"{META_BASE}{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, params={"access_token": token}, json=payload)
        return resp.json()


async def _meta_delete(token: str, path: str) -> dict:
    """Perform a DELETE request against the Meta Graph API."""
    url = f"{META_BASE}{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.delete(url, params={"access_token": token})
        return resp.json()


def _operation_status_to_status(operation_status: dict | None) -> str:
    if not operation_status:
        return "processing"
    code = operation_status.get("code")
    if code == 200:
        return "ready"
    if code in (400, 500):
        return "error"
    return "processing"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/{project_slug}")
async def list_audiences(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> list[dict]:
    """List all audiences for a project, refreshing size/status from Meta."""
    project = await _get_project(project_slug, db)
    token = project.meta_access_token or getattr(settings, "META_ACCESS_TOKEN", "")

    result = await db.execute(
        select(Audience)
        .where(Audience.project_id == project.id)
        .order_by(Audience.created_at.desc())
    )
    audiences = result.scalars().all()

    for audience in audiences:
        if audience.meta_audience_id and token:
            data = await _meta_get(
                token,
                f"/{audience.meta_audience_id}",
                {"fields": "id,name,approximate_count_lower_bound,operation_status"},
            )
            if "error" not in data:
                new_size = data.get("approximate_count_lower_bound")
                new_status = _operation_status_to_status(data.get("operation_status"))
                if new_size is not None and new_size != audience.size:
                    audience.size = new_size
                if new_status != audience.status:
                    audience.status = new_status

    await db.commit()
    return [_audience_to_dict(a) for a in audiences]


@router.post("/{project_slug}/website")
async def create_website_audience(
    project_slug: str,
    body: WebsiteAudienceRequest,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Create a website custom audience backed by a Meta Pixel."""
    project = await _get_project(project_slug, db)
    token, ad_account_id = _project_meta_creds(project)

    # Resolve pixel_id — check content_config first, then direct field
    pixel_id = (project.content_config or {}).get("meta_pixel_id") or getattr(project, "meta_pixel_id", None)
    if not pixel_id:
        raise HTTPException(status_code=400, detail="Project has no Meta Pixel ID configured")

    rule = {
        "inclusions": {
            "operator": "or",
            "rules": [
                {
                    "event_sources": [{"id": str(pixel_id), "type": "pixel"}],
                    "retention_seconds": body.retention_days * 86400,
                    "filter": {
                        "operator": "and",
                        "filters": [
                            {
                                "field": "event",
                                "operator": "=",
                                "value": body.event_type,
                            }
                        ],
                    },
                }
            ],
        }
    }

    meta_resp = await _meta_post_body(
        token,
        f"/act_{ad_account_id}/customaudiences",
        {"name": body.name, "rule": rule},
    )

    if "error" in meta_resp:
        err = meta_resp["error"]
        detail = err.get("error_user_msg") or err.get("message") or "Meta API error"
        raise HTTPException(status_code=400, detail=detail)

    audience = Audience(
        id=str(uuid4()),
        project_id=project.id,
        meta_audience_id=meta_resp.get("id"),
        name=body.name,
        type="website",
        subtype="WEBSITE",
        status="processing",
        retention_days=body.retention_days,
    )
    db.add(audience)
    await db.commit()
    await db.refresh(audience)
    return _audience_to_dict(audience)


@router.post("/{project_slug}/customer-list")
async def create_customer_list_audience(
    project_slug: str,
    name: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Create a customer-list custom audience from a CSV of email addresses."""
    project = await _get_project(project_slug, db)
    token, ad_account_id = _project_meta_creds(project)

    # Read and parse CSV
    content = await file.read()
    text = content.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    # Find email column (case-insensitive: email, Email, correo)
    fieldnames = reader.fieldnames or []
    email_col: str | None = None
    for candidate in ("email", "Email", "correo", "EMAIL"):
        if candidate in fieldnames:
            email_col = candidate
            break
    if email_col is None:
        # Try case-insensitive fallback
        for fn in fieldnames:
            if fn.lower() in ("email", "correo"):
                email_col = fn
                break
    if email_col is None:
        raise HTTPException(
            status_code=400,
            detail=f"No email column found. Detected columns: {fieldnames}",
        )

    hashed_emails = []
    for row in reader:
        raw = row.get(email_col, "").strip().lower()
        if raw:
            hashed_emails.append(hashlib.sha256(raw.encode()).hexdigest())

    if not hashed_emails:
        raise HTTPException(status_code=400, detail="CSV contains no valid email addresses")

    # Step 1: Create the custom audience
    create_resp = await _meta_post_json(
        token,
        f"/act_{ad_account_id}/customaudiences",
        {
            "name": name,
            "subtype": "CUSTOM",
            "customer_file_source": "USER_PROVIDED_ONLY",
        },
    )
    if "error" in create_resp:
        raise HTTPException(status_code=400, detail=create_resp["error"].get("message", "Meta API error"))

    meta_audience_id = create_resp.get("id")

    # Step 2: Upload hashed emails
    upload_resp = await _meta_post_json(
        token,
        f"/{meta_audience_id}/users",
        {
            "payload": {
                "schema": ["EMAIL_SHA256"],
                "data": [[h] for h in hashed_emails],
            }
        },
    )
    # Upload errors are non-fatal — audience still exists, just with 0 users
    upload_error = upload_resp.get("error")

    audience = Audience(
        id=str(uuid4()),
        project_id=project.id,
        meta_audience_id=meta_audience_id,
        name=name,
        type="customer_list",
        subtype="CUSTOM",
        status="processing",
    )
    db.add(audience)
    await db.commit()
    await db.refresh(audience)

    result = _audience_to_dict(audience)
    if upload_error:
        result["upload_warning"] = upload_error.get("message", "Email upload failed")
    return result


@router.post("/{project_slug}/engagement")
async def create_engagement_audience(
    project_slug: str,
    body: EngagementAudienceRequest,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Create an engagement custom audience from Instagram or Facebook activity."""
    project = await _get_project(project_slug, db)
    token, ad_account_id = _project_meta_creds(project)

    if body.platform == "instagram":
        source_id = project.instagram_account_id
        source_type = "ig_business"
        if not source_id:
            raise HTTPException(status_code=400, detail="Project has no Instagram account ID configured")
        event_value = _IG_ENGAGEMENT_MAP.get(body.engagement_type)
        if not event_value:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown engagement_type '{body.engagement_type}'. "
                       f"Valid: {list(_IG_ENGAGEMENT_MAP.keys())}",
            )
    elif body.platform == "facebook":
        source_id = project.facebook_page_id
        source_type = "page"
        if not source_id:
            raise HTTPException(status_code=400, detail="Project has no Facebook Page ID configured")
        event_value = body.engagement_type
    else:
        raise HTTPException(status_code=400, detail="platform must be 'instagram' or 'facebook'")

    rule = {
        "inclusions": {
            "operator": "or",
            "rules": [
                {
                    "event_sources": [{"id": str(source_id), "type": source_type}],
                    "retention_seconds": body.retention_days * 86400,
                    "filter": {
                        "operator": "and",
                        "filters": [
                            {"field": "event", "operator": "eq", "value": event_value}
                        ],
                    },
                }
            ],
        }
    }

    meta_resp = await _meta_post_json(
        token,
        f"/act_{ad_account_id}/customaudiences",
        {
            "name": body.name,
            "retention_days": body.retention_days,
            "rule": rule,
        },
    )

    if "error" in meta_resp:
        raise HTTPException(status_code=400, detail=meta_resp["error"].get("message", "Meta API error"))

    audience = Audience(
        id=str(uuid4()),
        project_id=project.id,
        meta_audience_id=meta_resp.get("id"),
        name=body.name,
        type="engagement",
        subtype="ENGAGEMENT",
        status="processing",
        retention_days=body.retention_days,
    )
    db.add(audience)
    await db.commit()
    await db.refresh(audience)
    return _audience_to_dict(audience)


def _meta_error_to_human(error: dict) -> str:
    """Map a Meta API error dict to a human-readable Spanish message."""
    code = error.get("code")
    subcode = error.get("error_subcode")
    # Error #2654 / subcode 1713008 — not enough people in source audience
    if code == 2654 or subcode == 1713008:
        return (
            "La audiencia fuente no tiene suficientes personas para crear un lookalike. "
            "Se necesitan al menos 100 usuarios matcheados por país."
        )
    # Fall back to Meta's own message
    return error.get("error_user_msg") or error.get("message") or "Error de la API de Meta"


@router.post("/{project_slug}/lookalike")
async def create_lookalike_audience(
    project_slug: str,
    body: LookalikeAudienceRequest,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> list[dict]:
    """Create lookalike audiences (one per country) from a source audience."""
    project = await _get_project(project_slug, db)
    token, ad_account_id = _project_meta_creds(project)

    # Load source audience from DB
    src_result = await db.execute(select(Audience).where(Audience.id == body.source_audience_id))
    source = src_result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Source audience not found")
    if not source.meta_audience_id:
        raise HTTPException(status_code=400, detail="Source audience has no Meta audience ID")

    successes: list[dict] = []
    failures: list[dict] = []

    for country in body.countries:
        payload = {
            "name": f"{body.name} — {country}",
            "subtype": "LOOKALIKE",
            "origin_audience_id": source.meta_audience_id,
            "lookalike_spec": {
                "type": "similarity",
                "ratio": body.ratio,
                "country": country,
            },
        }
        try:
            meta_resp = await _meta_post_json(
                token,
                f"/act_{ad_account_id}/customaudiences",
                payload,
            )
        except Exception as exc:
            failures.append({"country": country, "message": f"Error de conexión con Meta: {exc}"})
            continue

        if "error" in meta_resp:
            human_msg = _meta_error_to_human(meta_resp["error"])
            failures.append({"country": country, "message": human_msg})
            continue

        meta_id = meta_resp.get("id")
        new_id = str(uuid4())
        audience = Audience(
            id=new_id,
            project_id=project.id,
            meta_audience_id=meta_id,
            name=f"{body.name} — {country}",
            type="lookalike",
            subtype="LOOKALIKE",
            status="processing",
            source_audience_id=body.source_audience_id,
            lookalike_ratio=body.ratio,
            lookalike_countries=[country],
        )
        db.add(audience)
        try:
            await db.commit()
        except Exception as exc:
            await db.rollback()
            failures.append({"country": country, "message": f"Error al guardar en base de datos: {exc}"})
            continue
        await db.refresh(audience)
        successes.append(_audience_to_dict(audience))

    # All countries failed → 400
    if not successes:
        if len(failures) == 1:
            detail = failures[0]["message"]
        else:
            lines = "; ".join(f"{f['country']}: {f['message']}" for f in failures)
            detail = f"No se pudo crear ningún lookalike. {lines}"
        raise HTTPException(status_code=400, detail=detail)

    # Some succeeded, some failed → return successes with warnings attached
    if failures:
        result = successes.copy()
        result.append({
            "warnings": [
                {"country": f["country"], "message": f["message"]} for f in failures
            ]
        })
        return result

    return successes


@router.post("/{project_slug}/{audience_id}/add-users")
async def add_users_to_audience(
    project_slug: str,
    audience_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Add contacts from a CSV file to an existing customer-list audience."""
    project = await _get_project(project_slug, db)
    token = project.meta_access_token or getattr(settings, "META_ACCESS_TOKEN", "")
    if not token:
        raise HTTPException(status_code=400, detail="Project has no Meta access token configured")

    # Look up the audience and verify ownership + type
    result = await db.execute(
        select(Audience).where(Audience.id == audience_id, Audience.project_id == project.id)
    )
    audience = result.scalar_one_or_none()
    if not audience:
        raise HTTPException(status_code=400, detail="Audience not found")
    if audience.type != "customer_list":
        raise HTTPException(status_code=400, detail="Audience is not a customer_list type")
    if not audience.meta_audience_id:
        raise HTTPException(status_code=400, detail="Audience has no Meta audience ID")

    # Read and parse CSV
    content = await file.read()
    text = content.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    # Find email column (case-insensitive: email, Email, correo)
    fieldnames = reader.fieldnames or []
    email_col: str | None = None
    for candidate in ("email", "Email", "correo", "EMAIL"):
        if candidate in fieldnames:
            email_col = candidate
            break
    if email_col is None:
        for fn in fieldnames:
            if fn.lower() in ("email", "correo"):
                email_col = fn
                break
    if email_col is None:
        raise HTTPException(
            status_code=400,
            detail=f"No email column found. Detected columns: {fieldnames}",
        )

    hashed_emails = []
    for row in reader:
        raw = row.get(email_col, "").strip().lower()
        if raw:
            hashed_emails.append(hashlib.sha256(raw.encode()).hexdigest())

    if not hashed_emails:
        raise HTTPException(status_code=400, detail="CSV contains no valid email addresses")

    # Upload hashed emails to existing Meta audience
    upload_resp = await _meta_post_json(
        token,
        f"/{audience.meta_audience_id}/users",
        {
            "payload": {
                "schema": ["EMAIL_SHA256"],
                "data": [[h] for h in hashed_emails],
            }
        },
    )
    if "error" in upload_resp:
        err = upload_resp["error"]
        detail = err.get("error_user_msg") or err.get("message") or "Meta API error"
        raise HTTPException(status_code=400, detail=detail)

    return {"added": len(hashed_emails)}


@router.delete("/{project_slug}/{audience_id}")
async def delete_audience(
    project_slug: str,
    audience_id: str,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Delete an audience from DB and from Meta if it exists there."""
    project = await _get_project(project_slug, db)
    token = project.meta_access_token or getattr(settings, "META_ACCESS_TOKEN", "")

    result = await db.execute(
        select(Audience).where(Audience.id == audience_id, Audience.project_id == project.id)
    )
    audience = result.scalar_one_or_none()
    if not audience:
        raise HTTPException(status_code=404, detail="Audience not found")

    if audience.meta_audience_id and token:
        await _meta_delete(token, f"/{audience.meta_audience_id}")
        # Ignore Meta errors (audience may already be deleted on their side)

    await db.delete(audience)
    await db.commit()
    return {"deleted": True}


@router.get("/{project_slug}/sync")
async def sync_audiences(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> list[dict]:
    """Force-sync size and status for all audiences from Meta API."""
    project = await _get_project(project_slug, db)
    token = project.meta_access_token or getattr(settings, "META_ACCESS_TOKEN", "")

    result = await db.execute(
        select(Audience)
        .where(Audience.project_id == project.id)
        .order_by(Audience.created_at.desc())
    )
    audiences = result.scalars().all()

    for audience in audiences:
        if not audience.meta_audience_id or not token:
            continue
        data = await _meta_get(
            token,
            f"/{audience.meta_audience_id}",
            {"fields": "id,approximate_count_lower_bound,operation_status"},
        )
        if "error" in data:
            continue
        new_size = data.get("approximate_count_lower_bound")
        new_status = _operation_status_to_status(data.get("operation_status"))
        if new_size is not None:
            audience.size = new_size
        audience.status = new_status

    await db.commit()
    return [_audience_to_dict(a) for a in audiences]
