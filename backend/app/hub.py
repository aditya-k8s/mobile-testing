"""In-process registry of live WebSocket connections.

Single-instance MVP: for horizontal scaling, replace with a Redis pub/sub fan-out.
"""
import asyncio
import logging
from collections import defaultdict

from fastapi import WebSocket

log = logging.getLogger("family_monitor.hub")


async def _safe_send(ws: WebSocket, msg: dict) -> bool:
    try:
        await ws.send_json(msg)
        return True
    except Exception:  # socket already closed
        return False


class Hub:
    def __init__(self) -> None:
        self.parents: dict[str, set[WebSocket]] = defaultdict(set)
        self.devices: dict[str, WebSocket] = {}
        # session id -> {"parent": ws, "child": ws}
        self.rooms: dict[str, dict[str, WebSocket]] = {}

    # parent dashboards (a parent may have several tabs open)
    def add_parent(self, parent_id: str, ws: WebSocket) -> None:
        self.parents[parent_id].add(ws)

    def remove_parent(self, parent_id: str, ws: WebSocket) -> None:
        self.parents[parent_id].discard(ws)

    async def send_parent(self, parent_id: str, msg: dict) -> None:
        sockets = list(self.parents.get(parent_id, ()))
        if sockets:
            await asyncio.gather(*(_safe_send(ws, msg) for ws in sockets))

    # child devices (one control socket per device)
    async def add_device(self, device_id: str, ws: WebSocket) -> None:
        old = self.devices.get(device_id)
        self.devices[device_id] = ws
        if old is not None and old is not ws:
            try:
                await old.close(code=4000, reason="replaced")
            except Exception:
                pass

    def remove_device(self, device_id: str, ws: WebSocket) -> bool:
        if self.devices.get(device_id) is ws:
            del self.devices[device_id]
            return True
        return False

    def device_live(self, device_id: str) -> bool:
        return device_id in self.devices

    async def send_device(self, device_id: str, msg: dict) -> bool:
        ws = self.devices.get(device_id)
        return bool(ws) and await _safe_send(ws, msg)

    async def close_device(self, device_id: str, code: int, reason: str) -> None:
        ws = self.devices.pop(device_id, None)
        if ws is not None:
            try:
                await ws.close(code=code, reason=reason)
            except Exception:
                pass

    # screen-sharing signalling rooms
    async def join_room(self, sid: str, role: str, ws: WebSocket) -> dict[str, WebSocket]:
        room = self.rooms.setdefault(sid, {})
        old = room.get(role)
        room[role] = ws
        if old is not None and old is not ws:
            try:
                await old.close(code=4000, reason="replaced")
            except Exception:
                pass
        return room

    def leave_room(self, sid: str, role: str, ws: WebSocket) -> bool:
        room = self.rooms.get(sid)
        if not room or room.get(role) is not ws:
            return False
        del room[role]
        if not room:
            self.rooms.pop(sid, None)
        return True

    async def send_room_peer(self, sid: str, from_role: str, msg: dict) -> bool:
        room = self.rooms.get(sid) or {}
        other = room.get("child" if from_role == "parent" else "parent")
        return bool(other) and await _safe_send(other, msg)

    async def close_room(self, sid: str, reason: str) -> None:
        room = self.rooms.pop(sid, None) or {}
        for ws in room.values():
            await _safe_send(ws, {"type": "session_ended", "reason": reason})
            try:
                await ws.close(code=4001, reason="session ended")
            except Exception:
                pass


hub = Hub()
