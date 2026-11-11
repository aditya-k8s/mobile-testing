"""Optional Firebase Cloud Messaging (HTTP v1) sender.

Used only to alert the child's device that a screen-sharing request is waiting, so the child can
open the app and decide. Disabled unless FCM_SERVICE_ACCOUNT_FILE is configured.
"""
import asyncio
import json
import logging

import httpx

from .config import get_settings

log = logging.getLogger("family_monitor.fcm")
SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_creds = None
_project_id: str | None = None


def _load_credentials():
    global _creds, _project_id
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    path = get_settings().fcm_service_account_file
    if _creds is None:
        with open(path, encoding="utf-8") as fh:
            _project_id = json.load(fh)["project_id"]
        _creds = service_account.Credentials.from_service_account_file(path, scopes=[SCOPE])
    if not _creds.valid:
        _creds.refresh(Request())
    return _creds.token


async def push(fcm_token: str | None, title: str, body: str, data: dict[str, str]) -> bool:
    if not fcm_token or not get_settings().fcm_service_account_file:
        return False
    try:
        access_token = await asyncio.to_thread(_load_credentials)
        message = {
            "message": {
                "token": fcm_token,
                "notification": {"title": title, "body": body},
                "data": data,
                "android": {"priority": "high", "ttl": "90s",
                            "notification": {"channel_id": "share_requests"}},
            }
        }
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"https://fcm.googleapis.com/v1/projects/{_project_id}/messages:send",
                                  json=message, headers={"Authorization": f"Bearer {access_token}"})
        if r.status_code >= 300:
            log.warning("FCM send failed: %s %s", r.status_code, r.text[:300])
            return False
        return True
    except Exception:
        log.exception("FCM send failed")
        return False
