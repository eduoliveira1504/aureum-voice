"""Bug reports sent from the app ("Reportar problema"). Anyone signed in can send one; only the
app owner (AUREUM_OWNER_USERNAME) lists them, sees their screenshots and marks them resolved."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select

from app import ratelimit, storage
from app.config import get_settings
from app.deps import CurrentUser, SessionDep
from app.images import MAX_IMAGE_BYTES
from app.models import BugReport, User
from app.schemas import BugReportOut

router = APIRouter(tags=["bug reports"])

# Per user: enough to report a few things in a row, not to flood the owner.
REPORTS_PER_USER = (5, 10 * 60)
MAX_DESCRIPTION = 2000
MAX_LOGS = 100_000
SCREENSHOT_PREFIX = "bug-reports/"


def is_app_owner(user: User) -> bool:
    return user.username == get_settings().owner_username


def _require_owner(user: User) -> None:
    # 404, not 403: the owner screen doesn't exist for anyone else.
    if not is_app_owner(user):
        raise HTTPException(status.HTTP_404_NOT_FOUND)


def _out(report: BugReport) -> BugReportOut:
    return BugReportOut(
        id=report.id,
        author=report.author,  # type: ignore[arg-type]
        description=report.description,
        app_version=report.app_version,
        os=report.os,
        logs=report.logs,
        screenshot_url=f"{storage.MEDIA_PREFIX}bug-reports/{report.id}" if report.screenshot_key else None,
        resolved_at=report.resolved_at,
        created_at=report.created_at,
    )


@router.post("/bug-reports", status_code=status.HTTP_201_CREATED)
async def create_bug_report(
    user: CurrentUser,
    session: SessionDep,
    description: Annotated[str, Form(max_length=MAX_DESCRIPTION)],
    app_version: Annotated[str, Form(max_length=32)],
    os: Annotated[str, Form(max_length=100)],
    logs: Annotated[str, Form(max_length=MAX_LOGS)] = "",
    screenshot: Annotated[UploadFile | None, File(description="PNG or JPG of the app window")] = None,
) -> dict[str, uuid.UUID]:
    await ratelimit.hit(f"bug-report:{user.id}", *REPORTS_PER_USER)
    description = description.strip()
    if not description:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Describe the problem")
    report = BugReport(
        id=uuid.uuid4(), author_id=user.id, description=description, app_version=app_version.strip(),
        os=os.strip(), logs=logs,
    )
    if screenshot is not None:
        data = await screenshot.read(MAX_IMAGE_BYTES + 1)
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Screenshot must be at most 8 MB")
        detected = storage.sniff_image(data)
        if detected is None or detected[0] not in ("image/png", "image/jpeg"):
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Screenshot must be PNG or JPG")
        report.screenshot_key = f"{SCREENSHOT_PREFIX}{report.id}.{detected[1]}"
        await storage.put(report.screenshot_key, data, detected[0])
    session.add(report)
    try:
        await session.commit()
    except BaseException:
        if report.screenshot_key:
            await storage.delete(report.screenshot_key)
        raise
    return {"id": report.id}


@router.get("/bug-reports", response_model=list[BugReportOut])
async def list_bug_reports(user: CurrentUser, session: SessionDep) -> list[BugReportOut]:
    _require_owner(user)
    reports = await session.scalars(select(BugReport).order_by(BugReport.created_at.desc()).limit(200))
    return [_out(r) for r in reports]


class BugReportUpdate(BaseModel):
    resolved: bool


@router.patch("/bug-reports/{report_id}", response_model=BugReportOut)
async def update_bug_report(
    report_id: uuid.UUID, body: BugReportUpdate, user: CurrentUser, session: SessionDep
) -> BugReportOut:
    _require_owner(user)
    report = await session.get(BugReport, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if body.resolved != (report.resolved_at is not None):
        report.resolved_at = datetime.now(UTC) if body.resolved else None
        await session.commit()
        await session.refresh(report)
    return _out(report)


@router.get("/media/bug-reports/{report_id}")
async def get_bug_report_screenshot(report_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    _require_owner(user)
    report = await session.get(BugReport, report_id)
    stored = await storage.get(report.screenshot_key) if report and report.screenshot_key else None
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(
        stored.data,
        media_type=stored.content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"},
    )
