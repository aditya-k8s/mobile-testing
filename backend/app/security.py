import hashlib
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta

import bcrypt
import jwt

from .config import get_settings
from .models import utcnow

ALGO = "HS256"
# Unambiguous characters for human-typed pairing codes (no 0/O/1/I/L).
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_device_token() -> str:
    return secrets.token_urlsafe(32)


def new_pairing_code() -> str:
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalise_pairing_code(code: str) -> str:
    raw = "".join(c for c in code.upper() if c.isalnum())
    return f"{raw[:4]}-{raw[4:]}"


def create_access_token(parent_id: str) -> str:
    s = get_settings()
    now = utcnow()
    return jwt.encode({"sub": parent_id, "typ": "parent", "iat": now,
                       "exp": now + timedelta(minutes=s.access_token_minutes)}, s.jwt_secret, ALGO)


def create_stream_token(session_id: str, role: str, subject: str) -> str:
    """Short-lived token that only admits its holder to one screen-sharing session's signalling room."""
    s = get_settings()
    now = utcnow()
    return jwt.encode({"sub": subject, "typ": "stream", "sid": session_id, "role": role, "iat": now,
                       "exp": now + timedelta(seconds=s.stream_token_seconds)}, s.jwt_secret, ALGO)


def decode_token(token: str, typ: str) -> dict | None:
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    return claims if claims.get("typ") == typ else None


class RateLimiter:
    """Small in-memory sliding-window limiter. Sufficient for a single-instance MVP."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True


login_limiter = RateLimiter(limit=10, window_seconds=300)
pairing_limiter = RateLimiter(limit=10, window_seconds=300)
