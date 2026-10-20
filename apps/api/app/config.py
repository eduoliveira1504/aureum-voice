from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# The shared .env lives at the repository root; locate it from wherever the API runs.
# In Docker there is no .env file and settings come from environment variables.
ENV_FILES = tuple(p / ".env" for p in reversed(Path(__file__).resolve().parents))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILES,
        extra="ignore",
    )

    postgres_user: str
    postgres_password: str
    postgres_db: str
    # 127.0.0.1, not "localhost": on Windows the latter tries IPv6 first and stalls ~2s per
    # connection, because Docker only publishes these ports on IPv4.
    postgres_host: str = "127.0.0.1"
    postgres_port: int = 5433
    # Disables connection pooling (used by the test suite).
    db_null_pool: bool = False

    redis_host: str = "127.0.0.1"
    redis_port: int = 6379
    redis_password: str = ""
    # Namespaces pub/sub channels and keys (the test suite uses its own prefix).
    redis_prefix: str = "aureum"

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    # Browser origins allowed to call the API. The packaged app loads from file:// and its
    # fetch() calls send no Origin, so CORS only matters for web pages: deny them all.
    cors_origins: list[str] = ["http://localhost:5173"]
    # Origins allowed to open the WebSocket (the packaged app sends "file://").
    ws_origins: list[str] = ["file://", "http://localhost:5173"]
    # Read the client IP from X-Forwarded-For (last entry). Enable only behind a reverse
    # proxy that sets it; otherwise clients could spoof their IP to dodge rate limits.
    trust_forwarded_for: bool = False
    # The landing page (GitHub Pages). Only GET /api/public/stats answers it; empty = no one.
    public_site_origin: str = "https://eduoliveira1504.github.io"

    # S3-compatible storage (MinIO). It stays private: the API serves files at /api/media.
    minio_endpoint: str = "127.0.0.1:9000"
    minio_root_user: str
    minio_root_password: str
    minio_bucket: str = "aureum"
    minio_secure: bool = False
    # Largest file that can be sent in a conversation (MAX_ATTACHMENT_MB in .env).
    max_attachment_mb: int = 25

    # URL clients use to reach LiveKit (ws:// locally, wss:// in production).
    livekit_url: str = "ws://localhost:7880"
    # How the API itself reaches LiveKit's server API, when that differs from livekit_url
    # (e.g. http://livekit:7880 with LiveKit in this compose). Default: livekit_url over http(s).
    livekit_api_url: str | None = None
    livekit_api_key: str
    livekit_api_secret: str
    voice_token_minutes: int = 60

    # Username of the app owner's personal account: sees bug reports, gets the Founder badge.
    aureum_owner_username: str | None = None
    # While true, accounts that confirm their e-mail get the numbered beta badge.
    aureum_beta: bool = False
    # While true, signing up needs an account invite (a separate switch from AUREUM_BETA).
    aureum_invite_only: bool = True
    # The official bot's account (app/bot). It must be an official bot account (CLI --oficial).
    aureum_bot_username: str = "aureum"
    # Public GitHub repository whose releases the bot announces (empty: no announcements).
    aureum_releases_repo: str = "eduoliveira1504/aureum-voice"

    # Public address of the API (the Funnel URL): invite links, e-mail images and links.
    public_base_url: str = "http://localhost:8000"
    # Where installers come from: the newest GitHub release of this repository.
    releases_repo: str = "eduoliveira1504/aureum-voice"

    # E-mail: "smtp" sends for real; "memory" keeps messages in the process (tests).
    email_provider: Literal["smtp", "memory"] = "smtp"
    email_from: str = ""  # the address; the sender's name is always "Aureum"
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587  # 587 = STARTTLS, 465 = TLS from the start
    smtp_user: str = ""
    smtp_password: str = ""

    @property
    def owner_username(self) -> str | None:
        # "@edu" works too: that's how people write usernames.
        name = (self.aureum_owner_username or "").strip().lstrip("@").lower()
        return name or None

    @property
    def public_url(self) -> str:
        return self.public_base_url.rstrip("/")

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def livekit_http_url(self) -> str:
        url = self.livekit_api_url or self.livekit_url
        return url.replace("wss://", "https://", 1).replace("ws://", "http://", 1).rstrip("/")

    @property
    def redis_url(self) -> str:
        return f"redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}/0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
