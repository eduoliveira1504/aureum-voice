from functools import lru_cache
from pathlib import Path

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

    cors_origins: list[str] = ["*"]

    # URL clients use to reach LiveKit (ws:// locally, wss:// in production).
    livekit_url: str = "ws://localhost:7880"
    livekit_api_key: str
    livekit_api_secret: str
    voice_token_minutes: int = 60

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def redis_url(self) -> str:
        return f"redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}/0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
