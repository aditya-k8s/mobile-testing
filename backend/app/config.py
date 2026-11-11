import json
import logging
import secrets
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("family_monitor")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://family:family@localhost:5432/family_monitor"
    jwt_secret: str = ""
    access_token_minutes: int = 12 * 60
    stream_token_seconds: int = 60
    cors_origins: str = "http://localhost:5173"
    allow_registration: bool = True

    pairing_code_minutes: int = 10
    share_request_seconds: int = 90
    max_session_minutes: int = 30
    # A device with no live socket and no sync within this window is reported offline.
    # The child app's background worker syncs every 15 minutes, so keep this above that.
    offline_after_minutes: int = 20
    presence_check_seconds: int = 30

    ice_servers: str = '[{"urls":["stun:stun.l.google.com:19302"]}]'
    fcm_service_account_file: str = ""

    @field_validator("jwt_secret")
    @classmethod
    def _secret(cls, v: str) -> str:
        if not v:
            log.warning("JWT_SECRET is not set; using a random per-process secret (development only).")
            return secrets.token_urlsafe(48)
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ice_server_list(self) -> list[dict]:
        return json.loads(self.ice_servers)


@lru_cache
def get_settings() -> Settings:
    return Settings()
