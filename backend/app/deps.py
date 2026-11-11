from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .models import Device, Parent
from .security import decode_token, sha256

bearer = HTTPBearer(auto_error=False)


def _unauthorised() -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated",
                         headers={"WWW-Authenticate": "Bearer"})


async def current_parent(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                         db: AsyncSession = Depends(get_db)) -> Parent:
    claims = decode_token(creds.credentials, "parent") if creds else None
    parent = await db.get(Parent, claims["sub"]) if claims else None
    if parent is None:
        raise _unauthorised()
    return parent


async def device_from_token(db: AsyncSession, token: str) -> Device | None:
    return (await db.execute(
        select(Device).where(Device.token_hash == sha256(token), Device.revoked_at.is_(None))
    )).scalar_one_or_none()


async def current_device(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                         db: AsyncSession = Depends(get_db)) -> Device:
    device = await device_from_token(db, creds.credentials) if creds else None
    if device is None:
        raise _unauthorised()
    return device


async def owned_device(device_id: str, parent: Parent = Depends(current_parent),
                       db: AsyncSession = Depends(get_db)) -> Device:
    device = await db.get(Device, device_id)
    if device is None or device.parent_id != parent.id or device.revoked_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    return device
