"""End-to-end API test against SQLite. Run: pytest -q"""
import base64
import os
import tempfile
from datetime import datetime, timedelta, timezone

DB_FILE = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{DB_FILE}"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Device  # noqa: E402
from app.services import sweep  # noqa: E402

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\nfakeicon").decode()


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def drain_until(ws, wanted_type, limit=20):
    for _ in range(limit):
        msg = ws.receive_json()
        if msg.get("type") == wanted_type:
            return msg
    raise AssertionError(f"no {wanted_type} message")


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def register(client, email):
    r = client.post("/api/auth/register", json={"email": email, "name": "Sam Parent", "password": "correct-horse-1"})
    assert r.status_code == 201, r.text
    return r.json()["access_token"]


def pair(client, parent_token, name="Alex's phone"):
    code = client.post("/api/pairing-codes", headers=auth(parent_token)).json()["code"]
    r = client.post("/api/device/pair", json={"code": code.lower().replace("-", ""), "device_name": name,
                                               "model": "Pixel 8", "timezone": "Europe/London",
                                               "consent_accepted": True})
    assert r.status_code == 201, r.text
    return r.json(), code


def test_full_flow(client):
    parent = register(client, "parent@example.com")
    assert client.post("/api/auth/login", json={"email": "parent@example.com", "password": "wrong-password"}).status_code == 401
    assert client.get("/api/auth/me", headers=auth(parent)).json()["name"] == "Sam Parent"

    # Pairing requires consent and a single-use code.
    code = client.post("/api/pairing-codes", headers=auth(parent)).json()["code"]
    assert client.post("/api/device/pair", json={"code": code, "device_name": "x", "consent_accepted": False}).status_code == 400
    paired, used_code = pair(client, parent)
    assert client.post("/api/device/pair", json={"code": used_code, "device_name": "y", "consent_accepted": True}).status_code == 400
    dev_token, dev_id = paired["device_token"], paired["device_id"]

    # Usage sync (idempotent absolute totals) and icon upload.
    from zoneinfo import ZoneInfo
    today = datetime.now(ZoneInfo("Europe/London")).date()
    body = {"usage_permission": True,
            "current_app": {"package": "com.example.video", "name": "Video"},
            "days": [{"date": today.isoformat(), "apps": [
                        {"package": "com.example.video", "name": "Video", "foreground_ms": 3_600_000},
                        {"package": "com.example.chat", "name": "Chat", "foreground_ms": 600_000}]},
                     {"date": (today - timedelta(days=1)).isoformat(), "apps": [
                        {"package": "com.example.video", "name": "Video", "foreground_ms": 1_200_000}]}],
            "icons": [{"package": "com.example.video", "png_base64": PNG}]}
    r = client.post("/api/device/sync", json=body, headers=auth(dev_token))
    assert r.status_code == 200 and r.json()["missing_icons"] == ["com.example.chat"]
    client.post("/api/device/sync", json=body, headers=auth(dev_token))  # resend: no double counting

    s = client.get(f"/api/devices/{dev_id}/summary", headers=auth(parent)).json()
    assert s["today"]["total_ms"] == 4_200_000
    assert s["today"]["apps"][0]["name"] == "Video" and s["today"]["apps"][0]["icon"].startswith("data:image/png")
    assert s["device"]["current_app"]["name"] == "Video"
    week = client.get(f"/api/devices/{dev_id}/usage",
                      params={"from": (today - timedelta(days=6)).isoformat(), "to": today.isoformat()},
                      headers=auth(parent)).json()
    assert len(week["days"]) == 7 and week["total_ms"] == 5_400_000

    # Another parent cannot see this device.
    other = register(client, "other@example.com")
    assert client.get(f"/api/devices/{dev_id}/summary", headers=auth(other)).status_code == 404

    # Screen-sharing: request -> child approves -> both join signalling room -> relay -> end.
    with client.websocket_connect("/ws/parent") as pws, client.websocket_connect("/ws/device") as dws:
        pws.send_json({"type": "auth", "token": parent})
        assert pws.receive_json()["type"] == "ready"
        dws.send_json({"type": "auth", "token": dev_token})
        assert dws.receive_json()["type"] == "ready"

        sess = client.post(f"/api/devices/{dev_id}/screen-sessions", headers=auth(parent)).json()
        assert client.post(f"/api/devices/{dev_id}/screen-sessions", headers=auth(parent)).status_code == 409
        req = drain_until(dws, "share_request")
        assert req["session"]["id"] == sess["id"]

        # Parent cannot get a stream token before approval.
        assert client.post(f"/api/screen-sessions/{sess['id']}/stream-token", headers=auth(parent)).status_code == 409

        r = client.post(f"/api/device/screen-sessions/{sess['id']}/respond", json={"approve": True}, headers=auth(dev_token))
        child_stream = r.json()["stream_token"]
        assert r.json()["session"]["status"] == "approved"
        approved = drain_until(pws, "event")
        while approved["event"]["type"] != "share_approved":
            approved = drain_until(pws, "event")

        parent_stream = client.post(f"/api/screen-sessions/{sess['id']}/stream-token", headers=auth(parent)).json()["token"]
        assert client.post(f"/api/screen-sessions/{sess['id']}/stream-token", headers=auth(other)).status_code == 404

        with client.websocket_connect("/ws/stream") as child_ws, client.websocket_connect("/ws/stream") as viewer:
            child_ws.send_json({"type": "auth", "token": child_stream})
            assert child_ws.receive_json()["type"] == "joined"
            viewer.send_json({"type": "auth", "token": parent_stream})
            assert viewer.receive_json()["type"] == "joined"
            assert child_ws.receive_json()["type"] == "peer_joined"
            assert viewer.receive_json()["type"] == "peer_joined"
            child_ws.send_json({"type": "offer", "sdp": "v=0"})
            assert viewer.receive_json() == {"type": "offer", "sdp": "v=0"}
            viewer.send_json({"type": "answer", "sdp": "v=0"})
            assert child_ws.receive_json()["type"] == "answer"
            viewer.send_json({"type": "not-allowed"})  # ignored, not relayed

            assert client.post(f"/api/device/screen-sessions/{sess['id']}/started", headers=auth(dev_token)).json()["status"] == "active"
            child_ws.close()
            # Child leaving the room ends the session for the viewer.
            assert viewer.receive_json()["type"] == "session_ended"

        hist = client.get(f"/api/devices/{dev_id}/screen-sessions", headers=auth(parent)).json()
        assert hist[0]["status"] == "ended" and hist[0]["end_reason"] == "Sharing stopped on the device"

        # A stream token cannot rejoin an ended session.
        with client.websocket_connect("/ws/stream") as late:
            late.send_json({"type": "auth", "token": parent_stream})
            with pytest.raises(WebSocketDisconnect):
                late.receive_json()

        # Rejection path.
        sess2 = client.post(f"/api/devices/{dev_id}/screen-sessions", headers=auth(parent)).json()
        drain_until(dws, "share_request")
        r = client.post(f"/api/device/screen-sessions/{sess2['id']}/respond", json={"approve": False}, headers=auth(dev_token))
        assert r.json()["session"]["status"] == "rejected" and r.json()["stream_token"] is None

    types = [e["type"] for e in client.get("/api/events", params={"device_id": dev_id}, headers=auth(parent)).json()["events"]]
    for t in ("device_paired", "share_approved", "session_started", "session_ended", "share_rejected"):
        assert t in types

    # Presence: no live socket and stale sync -> offline; next sync -> reconnected.
    async def age_device():
        async with SessionLocal() as db:
            d = await db.get(Device, dev_id)
            d.last_seen_at = datetime.now(timezone.utc) - timedelta(hours=1)
            await db.commit()
            await sweep(db)
    client.portal.call(age_device)
    assert client.get(f"/api/devices/{dev_id}", headers=auth(parent)).json()["connection"] == "offline"
    client.post("/api/device/sync", json={"usage_permission": True}, headers=auth(dev_token))
    assert client.get(f"/api/devices/{dev_id}", headers=auth(parent)).json()["connection"] == "background"
    types = [e["type"] for e in client.get("/api/events", params={"notify_only": True}, headers=auth(parent)).json()["events"]]
    assert "device_offline" in types and "device_reconnected" in types

    # Revocation invalidates the device token immediately.
    assert client.delete(f"/api/devices/{dev_id}", headers=auth(parent)).status_code == 204
    assert client.get("/api/device/me", headers=auth(dev_token)).status_code == 401


def test_child_can_disconnect(client):
    parent = register(client, "p3@example.com")
    paired, _ = pair(client, parent, "Tablet")
    assert client.delete("/api/device/me", headers=auth(paired["device_token"])).status_code == 204
    assert client.get("/api/devices", headers=auth(parent)).json() == []
    events = client.get("/api/events", headers=auth(parent)).json()["events"]
    assert events[0]["type"] == "device_unpaired"


def test_unauthenticated_sockets_rejected(client):
    with client.websocket_connect("/ws/parent") as ws:
        ws.send_json({"type": "auth", "token": "nope"})
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
