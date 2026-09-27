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
    reel_source_images: list[str] | None
    reel_source_image_urls: list[str] | None
    reel_target_seconds: float
    reel_audio_path: str | None
    reel_audio_url: str | None
    reel_audio_start_seconds: float
    reel_audio_end_seconds: float | None
    reel_voice_audio_path: str | None
    reel_voice_audio_url: str | None
    reel_voice_audio_start_seconds: float
    reel_voice_audio_end_seconds: float | None
    reel_transition: str
    reel_zoom_style: str
    reel_image_transitions: list[str] | None
    reel_image_zoom_styles: list[str] | None
    reel_image_durations: list[float] | None
    reel_text_layers: list[dict] | None
    reel_image_text_layers: list[list[dict]] | None
    reel_image_color_filters: list[str] | None
    reel_warning: str | None
    platform: Platform | None
    social_account_id: str | None
    social_account_name: str | None
    also_post_to_instagram: bool
    scheduled_at: UtcDatetime | None
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
