"""Shared domain logic: serialisation, activity events, presence and screen-session lifecycle."""
import asyncio
import base64
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import fcm
from .config import get_settings
from .db import SessionLocal
from .hub import hub
from .models import AppInfo, Device, Event, ScreenSession, as_utc, utcnow

log = logging.getLogger("family_monitor")

OPEN_STATES = ("requested", "approved", "active")


def iso(dt: datetime | None) -> str | None:
    return as_utc(dt).isoformat() if dt else None


def device_zone(device: Device) -> ZoneInfo:
    try:
        return ZoneInfo(device.timezone)
    except Exception:
        return ZoneInfo("UTC")


def device_today(device: Device) -> date:
    return datetime.now(device_zone(device)).date()


def connection_state(device: Device) -> str:
    """live: control socket open (app in use); background: periodic sync recent; offline otherwise."""
    if device.revoked_at is not None:
        return "revoked"
    if hub.device_live(device.id):
        return "live"
    return "background" if device.is_online else "offline"


def device_out(d: Device) -> dict:
    return {
        "id": d.id, "name": d.name, "model": d.model, "platform": d.platform,
        "os_version": d.os_version, "app_version": d.app_version, "timezone": d.timezone,
        "paired_at": iso(d.paired_at), "consent_at": iso(d.consent_at),
        "last_seen_at": iso(d.last_seen_at), "connection": connection_state(d),
        "usage_permission": d.usage_permission,
        "current_app": ({"package": d.current_app_package, "name": d.current_app_name,
                         "since": iso(d.current_app_at)} if d.current_app_package else None),
    }


def event_out(e: Event) -> dict:
    return {"id": e.id, "device_id": e.device_id, "type": e.type, "message": e.message,
            "notify": e.notify, "created_at": iso(e.created_at), "read": e.read_at is not None}


def session_out(s: ScreenSession) -> dict:
    return {"id": s.id, "device_id": s.device_id, "status": s.status,
            "requested_at": iso(s.requested_at), "request_expires_at": iso(s.request_expires_at),
            "responded_at": iso(s.responded_at), "started_at": iso(s.started_at),
            "ended_at": iso(s.ended_at), "end_reason": s.end_reason}


def icon_data_uri(info: AppInfo | None) -> str | None:
    if info is None or not info.icon_png:
        return None
    return "data:image/png;base64," + base64.b64encode(info.icon_png).decode()


async def record_event(db: AsyncSession, parent_id: str, device_id: str | None, type_: str,
                       message: str, notify: bool = False) -> Event:
    event = Event(parent_id=parent_id, device_id=device_id, type=type_, message=message, notify=notify)
    db.add(event)
    await db.commit()
    await hub.send_parent(parent_id, {"type": "event", "event": event_out(event)})
    return event


async def broadcast_device(device: Device) -> None:
    await hub.send_parent(device.parent_id, {"type": "device", "device": device_out(device)})


async def broadcast_session(s: ScreenSession) -> None:
    await hub.send_parent(s.parent_id, {"type": "session", "session": session_out(s)})


async def mark_seen(db: AsyncSession, device: Device) -> None:
    first_contact = device.last_seen_at is None
    was_online = device.is_online
    device.last_seen_at = utcnow()
    device.is_online = True
    await db.commit()
    if not was_online and not first_contact:
        await record_event(db, device.parent_id, device.id, "device_reconnected",
                           f"{device.name} is back online.", notify=True)
    await broadcast_device(device)


async def open_session(db: AsyncSession, device_id: str) -> ScreenSession | None:
    return (await db.execute(
        select(ScreenSession).where(ScreenSession.device_id == device_id,
                                    ScreenSession.status.in_(OPEN_STATES))
        .order_by(ScreenSession.requested_at.desc())
    )).scalars().first()


async def close_session(db: AsyncSession, s: ScreenSession, reason: str) -> None:
    """Terminate a pending or running session and tell everyone involved."""
    if s.status not in OPEN_STATES:
        return
    device = await db.get(Device, s.device_id)
    name = device.name if device else "Device"
    was = s.status
    now = utcnow()
    if was == "requested":
        s.status, s.responded_at = ("expired" if reason == "expired" else "cancelled"), now
    else:
        s.status, s.ended_at = "ended", now
    s.end_reason = reason
    if was == "requested" and s.status == "expired":
        event = Event(type="share_expired", notify=True,
                      message=f"Screen-sharing request to {name} expired without a response.")
    elif was == "requested":
        event = Event(type="share_cancelled", notify=False,
                      message=f"Screen-sharing request to {name} was cancelled.")
    else:
        event = Event(type="session_ended", notify=True, message=f"Screen sharing on {name} ended ({reason}).")
    event.parent_id, event.device_id = s.parent_id, s.device_id
    db.add(event)
    # Persist state and history before any network I/O, so a dropped socket cannot lose them.
    await db.commit()

    await hub.close_room(s.id, reason)
    await hub.send_device(s.device_id, {"type": "session_closed", "session_id": s.id, "reason": reason})
    await broadcast_session(s)
    await hub.send_parent(s.parent_id, {"type": "event", "event": event_out(event)})


async def notify_share_request(device: Device, s: ScreenSession, parent_name: str) -> None:
    msg = {"type": "share_request", "session": session_out(s), "parent_name": parent_name}
    delivered = await hub.send_device(device.id, msg)
    if not delivered:
        await fcm.push(device.fcm_token, "Screen-sharing request",
                       f"{parent_name} would like to view your screen. Open the app to accept or decline.",
                       {"type": "share_request", "session_id": s.id})


async def sweep(db: AsyncSession) -> None:
    settings = get_settings()
    now = utcnow()

    cutoff = now - timedelta(minutes=settings.offline_after_minutes)
    online = (await db.execute(select(Device).where(Device.is_online.is_(True),
                                                    Device.revoked_at.is_(None)))).scalars().all()
    for d in online:
        if not hub.device_live(d.id) and (d.last_seen_at is None or as_utc(d.last_seen_at) < cutoff):
            d.is_online = False
            await db.commit()
            await record_event(db, d.parent_id, d.id, "device_offline", f"{d.name} went offline.", notify=True)
            await broadcast_device(d)

    sessions = (await db.execute(select(ScreenSession)
                                 .where(ScreenSession.status.in_(OPEN_STATES)))).scalars().all()
    max_run = timedelta(minutes=settings.max_session_minutes)
    for s in sessions:
        if s.status == "requested" and as_utc(s.request_expires_at) < now:
            await close_session(db, s, "expired")
        elif s.status == "approved" and as_utc(s.responded_at) < now - timedelta(minutes=2):
            await close_session(db, s, "Sharing did not start")
        elif s.status == "active" and as_utc(s.started_at) < now - max_run:
            await close_session(db, s, "Time limit reached")


async def background_loop() -> None:
    interval = get_settings().presence_check_seconds
    while True:
        await asyncio.sleep(interval)
        try:
            async with SessionLocal() as db:
                await sweep(db)
        except Exception:
            log.exception("Background sweep failed")
