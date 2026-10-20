import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import badges, mail, storage
from app.addons.registry import ADDONS
from app.bot import broadcast
from app.config import get_settings
from app.db import SessionLocal
from app.realtime import broker
from app.routers import addons, auth, badges as badges_router, bug_reports, calls, channels, dms, friends, moderation, public, roles, servers, users, web, ws

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        await storage.ensure_bucket()
    except Exception:  # storage down: the API still works, only uploads fail
        logging.getLogger(__name__).exception("Could not prepare the storage bucket")
    await broker.ensure_listening()
    async with SessionLocal() as session:
        await badges.sync_badges(session)
        await badges.grant_founder_if_due(session)
    workers = [asyncio.create_task(mail.run_worker()), asyncio.create_task(broadcast.run_worker())]
    yield
    for worker in workers:
        worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker
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
api.include_router(badges_router.router)
api.include_router(users.media_router)
api.include_router(servers.router)
api.include_router(channels.router)
api.include_router(roles.router)
api.include_router(moderation.router)
api.include_router(friends.router)
api.include_router(dms.router)
api.include_router(calls.router)
api.include_router(addons.router)
api.include_router(web.api_router)
api.include_router(public.router)
for addon in ADDONS.values():
    if addon.router is not None:
        api.include_router(addon.router, prefix=f"/addons/{addon.key}", tags=[f"addon:{addon.key}"])


@api.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api)
app.include_router(ws.router)
# Public through the Funnel: the invite page and the images in e-mails (Gmail shows no SVG).
app.include_router(web.page_router)
app.mount("/static", StaticFiles(directory=web.STATIC), name="static")
