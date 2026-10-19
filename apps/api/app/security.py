import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import get_settings

TokenType = Literal["access", "refresh"]

_hasher = PasswordHasher()
# Verified when the user doesn't exist, so login timing doesn't reveal registered e-mails.
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


@dataclass(frozen=True)
class TokenClaims:
    user_id: uuid.UUID
    # The user's session_epoch when the token was made; a token from an older epoch is dead.
    epoch: int


def create_token(user_id: uuid.UUID, token_type: TokenType, epoch: int = 0) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    lifetime = (
        timedelta(minutes=settings.access_token_minutes)
        if token_type == "access"
        else timedelta(days=settings.refresh_token_days)
    )
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "iat": now,
        "exp": now + lifetime,
        "jti": uuid.uuid4().hex,
        "ep": epoch,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: TokenType) -> TokenClaims | None:
    """The token's user and epoch, if it is valid and of the expected type. Callers still
    compare the epoch with the user's (see is_current)."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "type", "exp"]},
        )
        if payload["type"] != expected_type:
            return None
        return TokenClaims(uuid.UUID(payload["sub"]), int(payload.get("ep", 0)))
    except (jwt.PyJWTError, ValueError, TypeError):
        return None
