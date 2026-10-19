"""The only public web page: the invite page at /convite/{code} (sign-up, e-mail code, download;
no web login), plus the public bits of the API it reads. Served by the API, so through the
Funnel it lives on the same origin as /api and needs no CORS."""

import html
from functools import cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import HTMLResponse

from app import account_invites, ratelimit, releases
from app.deps import SessionDep
from app.models import AccountInvite, AccountInviteKind
from app.schemas import AccountInvitePreview, InviterOut, LatestRelease

STATIC = Path(__file__).resolve().parents[1] / "static"
LOOKUPS_PER_IP = (30, 60)

api_router = APIRouter(tags=["web"])
page_router = APIRouter(include_in_schema=False)


@api_router.get("/account-invites/{code}", response_model=AccountInvitePreview)
async def preview_invite(code: str, request: Request, session: SessionDep) -> AccountInvitePreview:
    """Who invites, or how many spots a group invite has left, before signing up."""
    await ratelimit.hit(f"invite-lookup:{ratelimit.client_ip(request)}", *LOOKUPS_PER_IP)
    invite = await session.get(AccountInvite, account_invites.normalize(code))
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite not found")
    return AccountInvitePreview(
        code=invite.code,
        kind=invite.kind.value,
        status=account_invites.status(invite),
        inviter=InviterOut.model_validate(invite.owner) if invite.owner else None,
        remaining=max(invite.max_uses - invite.uses, 0) if invite.kind == AccountInviteKind.group else None,
        expires_at=invite.expires_at,
    )


@api_router.get("/app/latest-release", response_model=LatestRelease)
async def latest_release() -> LatestRelease:
    release = await releases.latest()
    return LatestRelease(url=release.url, version=release.version, size_bytes=release.size_bytes)


@cache
def _page() -> str:
    return (STATIC / "convite" / "index.html").read_text(encoding="utf-8")


# Inline scripts and other origins are off: the page only runs its own convite.js.
PAGE_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
}


@page_router.get("/convite/{code}", response_class=HTMLResponse)
async def invite_page(code: str) -> HTMLResponse:
    # Only letters and digits survive normalize; the code reaches the script as a data attribute.
    body = _page().replace("{{code}}", html.escape(account_invites.normalize(code), quote=True))
    return HTMLResponse(body, headers=PAGE_HEADERS)
