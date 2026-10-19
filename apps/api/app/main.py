import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import storage
from app.addons.registry import ADDONS
from app.config import get_settings
from app.realtime import broker
from app.routers import addons, auth, bug_reports, calls, channels, dms, friends, moderation, roles, servers, users, ws

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
# Before media_router, whose /media/{key:path} would match its screenshot route.
api.include_router(bug_reports.router)
api.include_router(users.media_router)
api.include_router(servers.router)
api.include_router(channels.router)
api.include_router(roles.router)
api.include_router(moderation.router)
api.include_router(friends.router)
api.include_router(dms.router)
api.include_router(calls.router)
api.include_router(addons.router)
for addon in ADDONS.values():
    if addon.router is not None:
        api.include_router(addon.router, prefix=f"/addons/{addon.key}", tags=[f"addon:{addon.key}"])


@api.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api)
app.include_router(ws.router)
