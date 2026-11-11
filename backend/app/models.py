import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (BigInteger, Boolean, Date, DateTime, ForeignKey, Integer,
                        LargeBinary, String, Text)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uuid_str() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; normalise everything to aware UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


class Parent(Base):
    __tablename__ = "parents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class PairingCode(Base):
    __tablename__ = "pairing_codes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    parent_id: Mapped[str] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(TS)
    used_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    parent_id: Mapped[str] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120), default="")
    platform: Mapped[str] = mapped_column(String(20), default="android")
    os_version: Mapped[str] = mapped_column(String(40), default="")
    app_version: Mapped[str] = mapped_column(String(40), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    consent_at: Mapped[datetime] = mapped_column(TS)
    paired_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    revoked_by: Mapped[str | None] = mapped_column(String(10), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    usage_permission: Mapped[bool] = mapped_column(Boolean, default=False)
    current_app_package: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_app_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_app_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    fcm_token: Mapped[str | None] = mapped_column(String(512), nullable=True)


class AppInfo(Base):
    __tablename__ = "app_info"
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True)
    package: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    icon_png: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)


class UsageDaily(Base):
    __tablename__ = "usage_daily"
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    package: Mapped[str] = mapped_column(String(255), primary_key=True)
    foreground_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class ScreenSession(Base):
    __tablename__ = "screen_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[str] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"), index=True)
    # requested -> approved -> active -> ended
    # requested -> rejected | expired | cancelled ; approved -> ended
    status: Mapped[str] = mapped_column(String(16), default="requested", index=True)
    requested_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    request_expires_at: Mapped[datetime] = mapped_column(TS)
    responded_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    end_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)


class Event(Base):
    """Activity history. Rows with notify=True are also surfaced as parent notifications."""
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parent_id: Mapped[str] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text)
    notify: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
