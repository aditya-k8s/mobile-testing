"""Endpoints used by the parent dashboard."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import current_parent, owned_device
from ..hub import hub
from ..models import (AppInfo, Device, Event, PairingCode, Parent, ScreenSession, UsageDaily,
                      as_utc, utcnow)
from ..schemas import DeviceRename
from ..security import create_stream_token, new_pairing_code, sha256
from ..services import (broadcast_device, broadcast_session, close_session, device_out, device_today,
                        event_out, icon_data_uri, iso, notify_share_request, open_session,
                        record_event, session_out)

router = APIRouter(prefix="/api", tags=["parent"])


@router.get("/rtc-config")
async def rtc_config(_: Parent = Depends(current_parent)):
    return {"iceServers": get_settings().ice_server_list}


# Pairing and devices

@router.post("/pairing-codes", status_code=201)
async def create_pairing_code(parent: Parent = Depends(current_parent), db: AsyncSession = Depends(get_db)):
    # Invalidate any earlier unused codes so only one is valid at a time.
    await db.execute(update(PairingCode).where(PairingCode.parent_id == parent.id,
                                               PairingCode.used_at.is_(None)).values(used_at=utcnow()))
    code = new_pairing_code()
    expires = utcnow() + timedelta(minutes=get_settings().pairing_code_minutes)
    db.add(PairingCode(parent_id=parent.id, code_hash=sha256(code), expires_at=expires))
    await db.commit()
    return {"code": code, "expires_at": iso(expires)}


@router.get("/devices")
async def list_devices(parent: Parent = Depends(current_parent), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Device).where(Device.parent_id == parent.id, Device.revoked_at.is_(None))
                             .order_by(Device.paired_at))).scalars().all()
    return [device_out(d) for d in rows]


@router.get("/devices/{device_id}")
async def get_device(device: Device = Depends(owned_device)):
    return device_out(device)


@router.patch("/devices/{device_id}")
async def rename_device(body: DeviceRename, device: Device = Depends(owned_device),
                        db: AsyncSession = Depends(get_db)):
    device.name = body.name.strip()
    await db.commit()
    await broadcast_device(device)
    return device_out(device)


@router.delete("/devices/{device_id}", status_code=204)
async def revoke_device(purge: bool = False, device: Device = Depends(owned_device),
                        db: AsyncSession = Depends(get_db)):
    """Revoke access. With purge=true, also erase all data collected from the device."""
    s = await open_session(db, device.id)
    if s:
        await close_session(db, s, "Access revoked")
    device.revoked_at, device.revoked_by, device.is_online = utcnow(), "parent", False
    await db.commit()
    await hub.send_device(device.id, {"type": "revoked"})
    await hub.close_device(device.id, 4003, "revoked")
    if purge:
        for model in (UsageDaily, AppInfo, ScreenSession, Event):
            await db.execute(delete(model).where(model.device_id == device.id))
        await db.execute(delete(Device).where(Device.id == device.id))
        await db.commit()
        await record_event(db, device.parent_id, None, "device_removed",
                           f"{device.name} was removed and its data deleted.")
    else:
        await record_event(db, device.parent_id, device.id, "access_revoked",
                           f"Access to {device.name} was revoked.")
    await hub.send_parent(device.parent_id, {"type": "device_removed", "device_id": device.id})


# Usage

async def usage_report(db: AsyncSession, device: Device, start: date, end: date, limit: int | None = None) -> dict:
    rows = (await db.execute(select(UsageDaily).where(UsageDaily.device_id == device.id,
                                                      UsageDaily.day >= start, UsageDaily.day <= end))).scalars().all()
    per_day = {start + timedelta(days=i): 0 for i in range((end - start).days + 1)}
    per_app: dict[str, dict] = {}
    for r in rows:
        per_day[r.day] = per_day.get(r.day, 0) + r.foreground_ms
        a = per_app.setdefault(r.package, {"total_ms": 0, "last_used_at": None})
        a["total_ms"] += r.foreground_ms
        if r.last_used_at and (a["last_used_at"] is None or as_utc(r.last_used_at) > a["last_used_at"]):
            a["last_used_at"] = as_utc(r.last_used_at)

    ranked = sorted(((p, v) for p, v in per_app.items() if v["total_ms"] > 0),
                    key=lambda kv: kv[1]["total_ms"], reverse=True)
    if limit:
        ranked = ranked[:limit]
    infos = {}
    if ranked:
        infos = {i.package: i for i in (await db.execute(
            select(AppInfo).where(AppInfo.device_id == device.id,
                                  AppInfo.package.in_([p for p, _ in ranked])))).scalars().all()}
    return {
        "from": start.isoformat(), "to": end.isoformat(),
        "total_ms": sum(per_day.values()),
        "days": [{"date": d.isoformat(), "total_ms": ms} for d, ms in sorted(per_day.items())],
        "apps": [{"package": p, "name": infos[p].name if p in infos else p, "total_ms": v["total_ms"],
                  "last_used_at": iso(v["last_used_at"]), "icon": icon_data_uri(infos.get(p))}
                 for p, v in ranked],
    }


@router.get("/devices/{device_id}/usage")
async def get_usage(start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to"),
                    device: Device = Depends(owned_device), db: AsyncSession = Depends(get_db)):
    end = end or device_today(device)
    start = start or end
    if start > end or (end - start).days > 92:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid date range (maximum 93 days)")
    return await usage_report(db, device, start, end)


@router.get("/devices/{device_id}/summary")
async def summary(device: Device = Depends(owned_device), db: AsyncSession = Depends(get_db)):
    today = device_today(device)
    usage = await usage_report(db, device, today, today, limit=5)
    events = (await db.execute(select(Event).where(Event.device_id == device.id)
                               .order_by(Event.id.desc()).limit(8))).scalars().all()
    s = await open_session(db, device.id)
    return {"device": device_out(device), "today": usage, "session": session_out(s) if s else None,
            "recent_events": [event_out(e) for e in events]}


# Screen-sharing sessions

@router.post("/devices/{device_id}/screen-sessions", status_code=201)
async def request_session(device: Device = Depends(owned_device), parent: Parent = Depends(current_parent),
                          db: AsyncSession = Depends(get_db)):
    if device.platform != "android":
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Live screen sharing is only available for Android devices in this version.")
    if await open_session(db, device.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "A screen-sharing request or session is already open.")
    s = ScreenSession(device_id=device.id, parent_id=parent.id,
                      request_expires_at=utcnow() + timedelta(seconds=get_settings().share_request_seconds))
    db.add(s)
    await db.commit()
    await record_event(db, parent.id, device.id, "share_requested",
                       f"Screen-sharing request sent to {device.name}.")
    await broadcast_session(s)
    await notify_share_request(device, s, parent.name)
    return session_out(s)


async def _parent_session(db: AsyncSession, sid: str, parent: Parent) -> ScreenSession:
    s = await db.get(ScreenSession, sid)
    if s is None or s.parent_id != parent.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return s


@router.post("/screen-sessions/{sid}/end")
async def end_session(sid: str, parent: Parent = Depends(current_parent), db: AsyncSession = Depends(get_db)):
    s = await _parent_session(db, sid, parent)
    await close_session(db, s, "Stopped by parent")
    return session_out(s)


@router.post("/screen-sessions/{sid}/stream-token")
async def parent_stream_token(sid: str, parent: Parent = Depends(current_parent),
                              db: AsyncSession = Depends(get_db)):
    s = await _parent_session(db, sid, parent)
    if s.status not in ("approved", "active"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Session has not been approved by the child")
    return {"token": create_stream_token(s.id, "parent", parent.id),
            "expires_in": get_settings().stream_token_seconds}


@router.get("/devices/{device_id}/screen-sessions")
async def session_history(limit: int = Query(30, ge=1, le=200), device: Device = Depends(owned_device),
                          db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ScreenSession).where(ScreenSession.device_id == device.id)
                             .order_by(ScreenSession.requested_at.desc()).limit(limit))).scalars().all()
    return [session_out(s) for s in rows]


# Activity and notifications

@router.get("/events")
async def list_events(device_id: str | None = None, notify_only: bool = False, before_id: int | None = None,
                      limit: int = Query(50, ge=1, le=200), parent: Parent = Depends(current_parent),
                      db: AsyncSession = Depends(get_db)):
    q = select(Event).where(Event.parent_id == parent.id)
    if device_id:
        q = q.where(Event.device_id == device_id)
    if notify_only:
        q = q.where(Event.notify.is_(True))
    if before_id:
        q = q.where(Event.id < before_id)
    rows = (await db.execute(q.order_by(Event.id.desc()).limit(limit))).scalars().all()
    unread = len((await db.execute(select(Event.id).where(Event.parent_id == parent.id, Event.notify.is_(True),
                                                          Event.read_at.is_(None)))).all())
    return {"events": [event_out(e) for e in rows], "unread": unread}


@router.post("/events/read-all", status_code=204)
async def mark_all_read(parent: Parent = Depends(current_parent), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Event).where(Event.parent_id == parent.id, Event.read_at.is_(None))
                     .values(read_at=utcnow()))
    await db.commit()
