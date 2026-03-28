"""Notification endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_session, get_current_user
from app.services.notifications import NotificationService

router = APIRouter()


def notif_to_dict(n) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "action_url": n.action_url,
        "action_label": n.action_label,
        "action_data": n.action_data,
        "is_read": n.is_read,
        "created_at": str(n.created_at),
        "project_id": n.project_id,
    }


@router.get("")
async def get_notifications(
    page: int = 1,
    per_page: int = 20,
    unread_only: bool = False,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    svc = NotificationService(db)
    items = await svc.get_for_user(current_user.id, page, per_page, unread_only)
    count = await svc.get_unread_count(current_user.id)
    return {
        "items": [notif_to_dict(n) for n in items],
        "unread": count,
        "page": page,
    }


@router.get("/count")
async def get_unread_count(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    svc = NotificationService(db)
    count = await svc.get_unread_count(current_user.id)
    return {"unread": count}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    svc = NotificationService(db)
    ok = await svc.mark_read(notification_id, current_user.id)
    if not ok:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    svc = NotificationService(db)
    count = await svc.mark_all_read(current_user.id)
    return {"marked_read": count}
