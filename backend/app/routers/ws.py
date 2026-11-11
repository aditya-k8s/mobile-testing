"""WebSocket channels.

Every socket authenticates with its first message, {"type": "auth", "token": ...}, so tokens never
appear in URLs or access logs.

/ws/parent  parent dashboard: receives device status, session updates and notifications.
/ws/device  child app control channel: receives share requests and revocation; sends heartbeats.
/ws/stream  per-session WebRTC signalling room, admitted only with a short-lived stream token.
"""
import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..db import SessionLocal
from ..deps import device_from_token
from ..hub import hub
from ..models import Device, Parent, ScreenSession, utcnow
from ..security import decode_token
from ..services import (broadcast_device, close_session, device_out, mark_seen, notify_share_request,
                        open_session)

router = APIRouter()
log = logging.getLogger("family_monitor.ws")
MAX_MESSAGE = 64 * 1024
SIGNAL_TYPES = {"offer", "answer", "ice", "quality", "viewer_ready"}


async def _first_message_token(ws: WebSocket) -> str | None:
    await ws.accept()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        msg = json.loads(raw)
        return msg.get("token") if msg.get("type") == "auth" else None
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect, AttributeError):
        return None


async def _receive(ws: WebSocket) -> dict | None:
    raw = await ws.receive_text()
    if len(raw) > MAX_MESSAGE:
        return None
    try:
        msg = json.loads(raw)
    except ValueError:
        return None
    return msg if isinstance(msg, dict) else None


@router.websocket("/ws/parent")
async def parent_socket(ws: WebSocket):
    token = await _first_message_token(ws)
    claims = decode_token(token, "parent") if token else None
    async with SessionLocal() as db:
        parent = await db.get(Parent, claims["sub"]) if claims else None
    if parent is None:
        await ws.close(code=4401, reason="unauthorised")
        return
    hub.add_parent(parent.id, ws)
    await ws.send_json({"type": "ready"})
    try:
        while True:
            msg = await _receive(ws)
            if msg and msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove_parent(parent.id, ws)


@router.websocket("/ws/device")
async def device_socket(ws: WebSocket):
    token = await _first_message_token(ws)
    async with SessionLocal() as db:
        device = await device_from_token(db, token) if token else None
        if device is None:
            await ws.close(code=4401, reason="unauthorised")
            return
        device_id = device.id
        await hub.add_device(device_id, ws)
        await mark_seen(db, device)
        await ws.send_json({"type": "ready"})
        # Re-deliver a request that arrived while the app was closed.
        pending = await open_session(db, device_id)
        if pending is not None and pending.status == "requested":
            parent = await db.get(Parent, pending.parent_id)
            await notify_share_request(device, pending, parent.name)
    try:
        while True:
            msg = await _receive(ws)
            if not msg:
                continue
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
            elif msg.get("type") == "heartbeat":
                async with SessionLocal() as db:
                    device = await db.get(Device, device_id)
                    if device is None or device.revoked_at is not None:
                        break
                    app = msg.get("current_app")
                    if isinstance(app, dict) and isinstance(app.get("package"), str):
                        device.current_app_package = app["package"][:255]
                        device.current_app_name = str(app.get("name") or app["package"])[:255]
                        device.current_app_at = utcnow()
                    await mark_seen(db, device)
    except WebSocketDisconnect:
        pass
    finally:
        if hub.remove_device(device_id, ws):
            async with SessionLocal() as db:
                device = await db.get(Device, device_id)
                if device is not None and device.revoked_at is None:
                    await broadcast_device(device)  # connection drops from "live" to "background"


@router.websocket("/ws/stream")
async def stream_socket(ws: WebSocket):
    token = await _first_message_token(ws)
    claims = decode_token(token, "stream") if token else None
    if not claims or claims.get("role") not in ("parent", "child"):
        await ws.close(code=4401, reason="unauthorised")
        return
    sid, role, sub = claims["sid"], claims["role"], claims["sub"]
    async with SessionLocal() as db:
        s = await db.get(ScreenSession, sid)
        owner = s and (s.parent_id if role == "parent" else s.device_id)
        if s is None or owner != sub or s.status not in ("approved", "active"):
            await ws.close(code=4403, reason="session not available")
            return

    room = await hub.join_room(sid, role, ws)
    await ws.send_json({"type": "joined", "role": role})
    if "parent" in room and "child" in room:
        for peer in room.values():
            await peer.send_json({"type": "peer_joined"})
    try:
        while True:
            msg = await _receive(ws)
            if msg and msg.get("type") in SIGNAL_TYPES:
                await hub.send_room_peer(sid, role, msg)
    except WebSocketDisconnect:
        pass
    finally:
        if hub.leave_room(sid, role, ws):
            # Either side leaving ends the session: the child never streams to an empty room,
            # and a closed viewer never leaves capture running. Shielded so handler cancellation
            # on disconnect cannot interrupt the cleanup.
            reason = "Viewer closed" if role == "parent" else "Sharing stopped on the device"
            await asyncio.shield(_end_from_room(sid, reason))


async def _end_from_room(sid: str, reason: str) -> None:
    async with SessionLocal() as db:
        s = await db.get(ScreenSession, sid)
        if s is not None:
            await close_session(db, s, reason)
