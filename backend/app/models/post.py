from datetime import datetime, timezone
from enum import Enum

from beanie import Document, Indexed, PydanticObjectId
from pydantic import Field
from typing_extensions import Annotated


class PostStatus(str, Enum):
    scheduled = "scheduled"
    processing = "processing"
    published = "published"
    failed = "failed"


class Platform(str, Enum):
    facebook_page = "facebook_page"
    instagram_reel = "instagram_reel"
    instagram_post = "instagram_post"


class MediaType(str, Enum):
    image = "image"
    video = "video"


class ScheduledPost(Document):
    user_id: Annotated[PydanticObjectId, Indexed()]
    caption: str
    media_path: str | None = None
    media_type: MediaType | None = None
    platform: Platform | None = None
    social_account_id: PydanticObjectId | None = None
    also_post_to_instagram: bool = False
    scheduled_at: datetime
    status: PostStatus = PostStatus.scheduled
    published_at: datetime | None = None
    external_post_id: str | None = None
    error_message: str | None = None
    instagram_post_id: str | None = None
    instagram_error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "scheduled_posts"
