"""Endpoints used by the child's device. Authenticated with the per-device bearer token issued at pairing."""
import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import current_device
from ..models import AppInfo, Device, PairingCode, Parent, ScreenSession, UsageDaily, as_utc, utcnow
from ..schemas import EndIn, FcmTokenIn, PairIn, PairOut, RespondIn, SyncIn
from ..security import (create_stream_token, new_device_token, normalise_pairing_code, pairing_limiter,
                        sha256)
from ..services import (broadcast_device, broadcast_session, close_session, mark_seen, open_session,
                        record_event, session_out)

router = APIRouter(prefix="/api/device", tags=["device"])


@router.post("/pair", response_model=PairOut, status_code=201)
async def pair(body: PairIn, request: Request, db: AsyncSession = Depends(get_db)):
    if not body.consent_accepted:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The child must accept the monitoring notice to pair")
    ip = request.client.host if request.client else "unknown"
    if not pairing_limiter.allow(f"ip:{ip}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again in a few minutes.")
    code = (await db.execute(select(PairingCode).where(
        PairingCode.code_hash == sha256(normalise_pairing_code(body.code))))).scalar_one_or_none()
    if code is None or code.used_at is not None or as_utc(code.expires_at) < utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This pairing code is invalid or has expired")
    code.used_at = utcnow()
    token = new_device_token()
    device = Device(parent_id=code.parent_id, name=body.device_name.strip(), model=body.model,
                    platform=body.platform, os_version=body.os_version, app_version=body.app_version,
                    timezone=body.timezone, token_hash=sha256(token), consent_at=utcnow())
    db.add(device)
    await db.commit()
    parent = await db.get(Parent, code.parent_id)
    await record_event(db, parent.id, device.id, "device_paired",
                       f"{device.name} was connected. The child accepted the monitoring notice.", notify=True)
    await broadcast_device(device)
    return PairOut(device_id=device.id, device_token=token, parent_name=parent.name)


@router.get("/me")
async def me(device: Device = Depends(current_device), db: AsyncSession = Depends(get_db)):
    parent = await db.get(Parent, device.parent_id)
    return {"device_id": device.id, "name": device.name, "parent_name": parent.name,
            "consent_at": device.consent_at.isoformat()}


@router.delete("/me", status_code=204)
async def unpair(device: Device = Depends(current_device), db: AsyncSession = Depends(get_db)):
    """The child can disconnect at any time. The parent is told."""
    s = await open_session(db, device.id)
    if s:
        await close_session(db, s, "Device disconnected")
    device.revoked_at, device.revoked_by, device.is_online = utcnow(), "child", False
    await db.commit()
    await record_event(db, device.parent_id, device.id, "device_unpaired",
                       f"{device.name} disconnected monitoring from the device.", notify=True)
    await broadcast_device(device)


@router.get("/rtc-config")
async def rtc_config(_: Device = Depends(current_device)):
    return {"iceServers": get_settings().ice_server_list}


@router.post("/fcm-token", status_code=204)
async def set_fcm_token(body: FcmTokenIn, device: Device = Depends(current_device),
                        db: AsyncSession = Depends(get_db)):
    device.fcm_token = body.token
    await db.commit()


@router.post("/sync")
async def sync(body: SyncIn, device: Device = Depends(current_device), db: AsyncSession = Depends(get_db)):
    """Upload per-app foreground totals per local day. Totals are absolute, so re-sending is idempotent."""
    now = utcnow()
    if device.usage_permission != body.usage_permission and not body.usage_permission:
        await record_event(db, device.parent_id, device.id, "usage_permission_off",
                           f"Usage access was turned off on {device.name}. App usage will not update.",
                           notify=True)
    device.usage_permission = body.usage_permission
    if body.current_app:
        device.current_app_package = body.current_app.package
        device.current_app_name = body.current_app.name
        device.current_app_at = body.current_app.since or now

    names: dict[str, str] = {}
    for day in body.days:
        existing = {u.package: u for u in (await db.execute(select(UsageDaily).where(
            UsageDaily.device_id == device.id, UsageDaily.day == day.date))).scalars().all()}
        for a in day.apps:
            names[a.package] = a.name
            row = existing.get(a.package)
            if row is None:
                row = UsageDaily(device_id=device.id, day=day.date, package=a.package)
                db.add(row)
                existing[a.package] = row
            row.foreground_ms = a.foreground_ms
            row.last_used_at = a.last_used_at
            row.updated_at = now

    infos = {i.package: i for i in (await db.execute(select(AppInfo).where(
        AppInfo.device_id == device.id, AppInfo.package.in_(list(names) or [""])))).scalars().all()}
    icons = {}
    for icon in body.icons:
        try:
            icons[icon.package] = base64.b64decode(icon.png_base64, validate=True)
        except (binascii.Error, ValueError):
            continue
    for pkg, name in names.items():
        info = infos.get(pkg)
        if info is None:
            info = AppInfo(device_id=device.id, package=pkg, name=name)
            db.add(info)
            infos[pkg] = info
        info.name = name
        if pkg in icons:
            info.icon_png = icons[pkg]
    await db.commit()
    await mark_seen(db, device)
    return {"missing_icons": [p for p, i in infos.items() if not i.icon_png]}


# Screen-sharing (child side)

async def _device_session(db: AsyncSession, sid: str, device: Device) -> ScreenSession:
    s = await db.get(ScreenSession, sid)
    if s is None or s.device_id != device.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return s


@router.get("/screen-sessions/pending")
async def pending(device: Device = Depends(current_device), db: AsyncSession = Depends(get_db)):
    s = await open_session(db, device.id)
    if s is None:
        return {"session": None}
    parent = await db.get(Parent, s.parent_id)
    return {"session": session_out(s), "parent_name": parent.name}


@router.post("/screen-sessions/{sid}/respond")
async def respond(sid: str, body: RespondIn, device: Device = Depends(current_device),
                  db: AsyncSession = Depends(get_db)):
    s = await _device_session(db, sid, device)
    if s.status != "requested" or as_utc(s.request_expires_at) < utcnow():
        raise HTTPException(status.HTTP_410_GONE, "This request is no longer open")
    s.responded_at = utcnow()
    s.status = "approved" if body.approve else "rejected"
    await db.commit()
    await broadcast_session(s)
    if body.approve:
        await record_event(db, s.parent_id, device.id, "share_approved",
                           f"{device.name} approved your screen-sharing request.", notify=True)
        return {"session": session_out(s), "stream_token": create_stream_token(s.id, "child", device.id)}
    await record_event(db, s.parent_id, device.id, "share_rejected",
                       f"{device.name} declined your screen-sharing request.", notify=True)
    return {"session": session_out(s), "stream_token": None}


@router.post("/screen-sessions/{sid}/started")
async def started(sid: str, device: Device = Depends(current_device), db: AsyncSession = Depends(get_db)):
    s = await _device_session(db, sid, device)
    if s.status == "active":
        return session_out(s)
    if s.status != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "Session is not approved")
    s.status, s.started_at = "active", utcnow()
    await db.commit()
    await broadcast_session(s)
    await record_event(db, s.parent_id, device.id, "session_started",
                       f"Screen sharing started on {device.name}.", notify=True)
    return session_out(s)


@router.post("/screen-sessions/{sid}/end")
async def end(sid: str, body: EndIn, device: Device = Depends(current_device), db: AsyncSession = Depends(get_db)):
    s = await _device_session(db, sid, device)
    await close_session(db, s, body.reason or "Stopped by child")
    return session_out(s)


@router.post("/screen-sessions/{sid}/stream-token")
async def child_stream_token(sid: str, device: Device = Depends(current_device), db: AsyncSession = Depends(get_db)):
    s = await _device_session(db, sid, device)
    if s.status not in ("approved", "active"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Session is not approved")
    return {"token": create_stream_token(s.id, "child", device.id)}
