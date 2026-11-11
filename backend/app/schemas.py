from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("password")
    @classmethod
    def _bcrypt_limit(cls, v: str) -> str:
        if len(v.encode()) > 72:
            raise ValueError("Password must be at most 72 bytes")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ParentOut(BaseModel):
    id: str
    email: str
    name: str


class PairIn(BaseModel):
    code: str = Field(min_length=8, max_length=12)
    device_name: str = Field(min_length=1, max_length=80)
    model: str = Field(default="", max_length=120)
    platform: str = Field(default="android", pattern="^(android|ios)$")
    os_version: str = Field(default="", max_length=40)
    app_version: str = Field(default="", max_length=40)
    timezone: str = Field(default="UTC", max_length=64)
    consent_accepted: bool


class PairOut(BaseModel):
    device_id: str
    device_token: str
    parent_name: str


class DeviceRename(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class CurrentApp(BaseModel):
    package: str = Field(max_length=255)
    name: str = Field(max_length=255)
    since: datetime | None = None


class AppUsageIn(BaseModel):
    package: str = Field(max_length=255)
    name: str = Field(max_length=255)
    foreground_ms: int = Field(ge=0, le=24 * 3600 * 1000)
    last_used_at: datetime | None = None


class DayUsageIn(BaseModel):
    date: date
    apps: list[AppUsageIn] = Field(max_length=500)


class IconIn(BaseModel):
    package: str = Field(max_length=255)
    png_base64: str = Field(max_length=90_000)


class SyncIn(BaseModel):
    usage_permission: bool
    current_app: CurrentApp | None = None
    days: list[DayUsageIn] = Field(default_factory=list, max_length=8)
    icons: list[IconIn] = Field(default_factory=list, max_length=60)


class FcmTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=512)


class RespondIn(BaseModel):
    approve: bool


class EndIn(BaseModel):
    reason: str = Field(default="Stopped", max_length=120)
