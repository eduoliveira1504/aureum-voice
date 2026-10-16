import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import storage
from app.config import get_settings
from app.realtime import broker
from app.routers import auth, channels, servers, users, ws

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        await storage.ensure_bucket()
    except Exception:  # storage down: the API still works, only uploads fail
        logging.getLogger(__name__).exception("Could not prepare the storage bucket")
    await broker.ensure_listening()
    yield
    await broker.close()


app = FastAPI(
    title="Aureum Voice API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
api.include_router(auth.router)
api.include_router(users.router)
api.include_router(users.media_router)
api.include_router(servers.router)
api.include_router(channels.router)


@api.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api)
app.include_router(ws.router)
