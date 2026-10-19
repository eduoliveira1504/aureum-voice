"""Media tiers: how much quality a plan may send in calls (camera and screen share).

The voice token carries the caller's tier and the app applies it to what it publishes. LiveKit's
token can say *what* may be published but not at what resolution, so the limits are applied by
the client; the server is where they're decided, so new plans only change this table. See
docs/decisions/0017-media-tiers.md.
"""

from typing import Literal

from pydantic import BaseModel

from app.models import UserPlan

Resolution = Literal["720p", "1080p", "1440p"]


class MediaTier(BaseModel):
    plan: UserPlan
    # Largest screen share and camera the app publishes.
    max_screen: Resolution
    max_camera: Resolution
    # Highest frame rate for either.
    max_fps: int


TIERS: dict[UserPlan, MediaTier] = {
    UserPlan.free: MediaTier(plan=UserPlan.free, max_screen="720p", max_camera="720p", max_fps=30),
}


def tier_for(plan: UserPlan) -> MediaTier:
    return TIERS.get(plan, TIERS[UserPlan.free])
