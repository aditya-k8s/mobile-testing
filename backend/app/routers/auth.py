from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import current_parent
from ..models import Parent
from ..schemas import LoginIn, ParentOut, RegisterIn, TokenOut
from ..security import create_access_token, hash_password, login_limiter, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Equalises timing between "unknown email" and "wrong password".
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)):
    if not get_settings().allow_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is disabled")
    email = body.email.lower()
    if (await db.execute(select(Parent).where(Parent.email == email))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    parent = Parent(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(parent)
    await db.commit()
    return TokenOut(access_token=create_access_token(parent.id))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    email = body.email.lower()
    ip = request.client.host if request.client else "unknown"
    if not (login_limiter.allow(f"ip:{ip}") and login_limiter.allow(f"email:{email}")):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again in a few minutes.")
    parent = (await db.execute(select(Parent).where(Parent.email == email))).scalar_one_or_none()
    ok = verify_password(body.password, parent.password_hash if parent else _DUMMY_HASH)
    if not parent or not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    return TokenOut(access_token=create_access_token(parent.id))


@router.get("/me", response_model=ParentOut)
async def me(parent: Parent = Depends(current_parent)):
    return ParentOut(id=parent.id, email=parent.email, name=parent.name)
