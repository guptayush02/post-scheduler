from datetime import datetime, timezone
from enum import Enum

from beanie import Document, Indexed, PydanticObjectId
from pydantic import Field
from typing_extensions import Annotated


class PostStatus(str, Enum):
    # Reel lifecycle: generating_video (ffmpeg queued/running in the
    # background - independent of the compose page staying open) ->
    # draft (video ready, awaiting the user previewing it and confirming a
    # schedule via POST /{id}/schedule) -> scheduled (same pipeline as any
    # other post from here on).
    generating_video = "generating_video"
    draft = "draft"
    generation_failed = "generation_failed"
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
    # Ordered reel segments - still images and/or video clips (uploads or
    # AI footage), despite the name.
    reel_source_images: list[str] | None = None
    # Set on create: the poller still has to produce AI/fallback footage
    # (see reel_assets.prepare_reel_sources) before the first render.
    # Cleared once done, so regenerating reuses that footage instead of
    # paying Hugging Face for it again.
    reel_ai_pending: bool = False
    reel_use_ai_video: bool = False
    # Params the background poller renders with - stored on the doc (rather
    # than passed in-memory) since regeneration re-enters the same
    # generate -> poll -> draft pipeline as a fresh reel.
    reel_target_seconds: float = 45.0
    # "Music" track.
    reel_audio_path: str | None = None
    reel_audio_start_seconds: float = 0.0
    reel_audio_end_seconds: float | None = None
    # "Voiceover" track - when both this and the music track are set, the
    # music is auto-ducked under the voice and the two are mixed.
    reel_voice_audio_path: str | None = None
    reel_voice_audio_start_seconds: float = 0.0
    reel_voice_audio_end_seconds: float | None = None
    # Uniform fallback used until per-image overrides below are set.
    reel_transition: str = "fade"
    reel_zoom_style: str = "zoom_in"
    # Per-image overrides, same order/length as reel_source_images.
    # reel_image_transitions[i] is the crossfade used going from image i
    # into image i+1 (its last entry is unused). None until the user
    # customizes an individual image.
    reel_image_transitions: list[str] | None = None
    reel_image_zoom_styles: list[str] | None = None
    # Per-image on-screen seconds (same order as reel_source_images). The
    # video's total length is derived from this (sum minus overlaps), not a
    # fixed target, once set. None until the user customizes an image -
    # reel_target_seconds is then split evenly instead.
    reel_image_durations: list[float] | None = None
    # User-added text on the video (never the caption). reel_text_layers
    # show for the whole video; reel_image_text_layers[i] only while image i
    # is on screen (same order/length as reel_source_images). Layer shape:
    # see services/reel_text.py.
    reel_text_layers: list[dict] | None = None
    reel_image_text_layers: list[list[dict]] | None = None
    # Per-image colour grading preset (same order as reel_source_images).
    reel_image_color_filters: list[str] | None = None
    # Template (see services/reel_templates.py) and the brand details its
    # graphics use. The title is only ever what the user typed.
    reel_template: str | None = None
    # Per-clip template overrides (same order as reel_source_images; None =
    # use reel_template) - lets different stretches of one reel use
    # different templates.
    reel_clip_templates: list[str | None] | None = None
    reel_brand_color: str = "#4F46E5"
    reel_title_text: str | None = None
    reel_logo_path: str | None = None
    # Logo centre as a fraction of the frame, and its width as a fraction
    # of the frame width - set by dragging/resizing it in the preview.
    reel_logo_x: float = 0.85
    reel_logo_y: float = 0.08
    reel_logo_scale: float = 0.16
    # Animated call-to-action badges, independent of templates - shape in
    # services/reel_text.py. `clip` indexes reel_source_images. Their links
    # can't be clickable inside a video, so they're appended to the post
    # text when publishing (see scheduler).
    reel_ctas: list[dict] | None = None
    # Non-fatal problem from the last render (e.g. text couldn't be burned
    # in because this server's ffmpeg has no drawtext filter).
    reel_warning: str | None = None
    platform: Platform | None = None
    social_account_id: PydanticObjectId | None = None
    also_post_to_instagram: bool = False
    scheduled_at: datetime | None = None
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
