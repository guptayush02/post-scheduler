from datetime import datetime, timezone
from typing import Annotated

from pydantic import BaseModel, BeforeValidator

from app.models.post import MediaType, Platform, PostStatus


def _ensure_utc(value: object) -> object:
    # MongoDB strips timezone info from stored datetimes, so values read back
    # via Beanie come back naive even though they were saved as UTC. Reattach
    # UTC tzinfo here so API responses always carry an explicit offset.
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


UtcDatetime = Annotated[datetime, BeforeValidator(_ensure_utc)]


class PostResponse(BaseModel):
    id: str
    caption: str
    media_path: str | None
    media_url: str | None
    media_type: MediaType | None
    platform: Platform | None
    social_account_id: str | None
    social_account_name: str | None
    also_post_to_instagram: bool
    scheduled_at: UtcDatetime
    status: PostStatus
    published_at: UtcDatetime | None
    external_post_id: str | None
    error_message: str | None
    instagram_post_id: str | None
    instagram_error: str | None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class PaginatedPosts(BaseModel):
    items: list[PostResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
