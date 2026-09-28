import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.media import media_url_path
from app.services import ai_editor, hf_media
from app.services.reel_templates import REEL_TEMPLATES, apply_template, get_template, public_templates

REEL_TEMPLATE_IDS = list(REEL_TEMPLATES)
from app.models.post import MediaType, Platform, PostStatus, ScheduledPost
from app.services.reel_generator import (
    COLOR_FILTERS,
    DEFAULT_TRANSITION,
    DEFAULT_ZOOM_STYLE,
    MAX_IMAGE_SECONDS,
    MIN_IMAGE_SECONDS,
    XFADE_TRANSITIONS,
    ZOOM_STYLES,
)
from app.services.reel_text import MAX_CTAS, MAX_TEXT_LAYERS, normalize_ctas, normalize_text_layers, public_fonts
from app.models.social_account import SocialAccount
from app.models.user import User
from app.schemas.post import AIEditResponse, PaginatedPosts, PostResponse

router = APIRouter(prefix="/api/posts", tags=["posts"])

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
# .webm/.ogg are what browsers record voiceovers in (Chrome/Firefox);
# Safari records .m4a.
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".webm", ".opus"}

# Zero is fine: a text-only reel gets AI footage or title cards instead.
MAX_REEL_SOURCES = 20
MIN_REEL_SECONDS = 15
MAX_REEL_SECONDS = 90
# Bounds for a new reel's length (regenerating allows the wider range above).
MIN_NEW_REEL_SECONDS = 30
MAX_NEW_REEL_SECONDS = 60


def _media_type_for(filename: str) -> MediaType | None:
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return MediaType.image
    if ext in VIDEO_EXTENSIONS:
        return MediaType.video
    return None


async def _save_upload(user_id: PydanticObjectId, file: UploadFile) -> tuple[str, MediaType | None]:
    media_type = _media_type_for(file.filename or "")
    if media_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported media type. Allowed: jpg, jpeg, png, gif, webp, mp4, mov, m4v, webm",
        )

    user_dir = Path(settings.uploads_dir) / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "").suffix.lower()
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = user_dir / filename

    contents = await file.read()
    dest.write_bytes(contents)

    return str(dest.as_posix()), media_type


async def _save_reel_sources(user_id: PydanticObjectId, files: list[UploadFile]) -> list[str]:
    files = [f for f in files if f.filename]
    if len(files) > MAX_REEL_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A reel can use at most {MAX_REEL_SOURCES} images/videos",
        )

    paths: list[str] = []
    for file in files:
        if _media_type_for(file.filename or "") is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type for reel generation: {file.filename}",
            )
        path, _ = await _save_upload(user_id, file)
        paths.append(path)

    return paths


async def _save_audio_upload(user_id: PydanticObjectId, file: UploadFile) -> str:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported audio type. Allowed: {', '.join(sorted(AUDIO_EXTENSIONS))}",
        )

    user_dir = Path(settings.uploads_dir) / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    dest = user_dir / filename

    contents = await file.read()
    dest.write_bytes(contents)

    return str(dest.as_posix())


def _parse_text_layers(raw: str, field_name: str) -> list[dict] | None:
    """Parses a JSON array of text layers. Empty string means "not sent"
    (keep whatever is stored); "[]" means the user cleared all layers.
    """
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {field_name} JSON")
    if not isinstance(parsed, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} must be a list")
    if len(parsed) > MAX_TEXT_LAYERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"At most {MAX_TEXT_LAYERS} text layers are allowed",
        )
    # Empty layers are dropped; bad values fall back to defaults.
    return normalize_text_layers(parsed)


async def _resolve_social_account(
    social_account_id: str | None, user: User
) -> SocialAccount | None:
    if not social_account_id:
        return None

    try:
        oid = PydanticObjectId(social_account_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid social account")

    account = await SocialAccount.get(oid)
    if not account or account.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Social account not found")

    return account


def _post_response(post: ScheduledPost, account_name: str | None) -> PostResponse:
    return PostResponse(
        id=str(post.id),
        caption=post.caption,
        media_path=post.media_path,
        media_url=media_url_path(post.media_path) if post.media_path else None,
        media_type=post.media_type,
        reel_source_images=post.reel_source_images,
        reel_source_image_urls=(
            [media_url_path(p) for p in post.reel_source_images] if post.reel_source_images else None
        ),
        reel_target_seconds=post.reel_target_seconds,
        reel_audio_path=post.reel_audio_path,
        reel_audio_url=media_url_path(post.reel_audio_path) if post.reel_audio_path else None,
        reel_audio_start_seconds=post.reel_audio_start_seconds,
        reel_audio_end_seconds=post.reel_audio_end_seconds,
        reel_voice_audio_path=post.reel_voice_audio_path,
        reel_voice_audio_url=media_url_path(post.reel_voice_audio_path) if post.reel_voice_audio_path else None,
        reel_voice_audio_start_seconds=post.reel_voice_audio_start_seconds,
        reel_voice_audio_end_seconds=post.reel_voice_audio_end_seconds,
        reel_transition=post.reel_transition,
        reel_zoom_style=post.reel_zoom_style,
        reel_image_transitions=post.reel_image_transitions,
        reel_image_zoom_styles=post.reel_image_zoom_styles,
        reel_image_durations=post.reel_image_durations,
        reel_text_layers=post.reel_text_layers,
        reel_image_text_layers=post.reel_image_text_layers,
        reel_image_color_filters=post.reel_image_color_filters,
        reel_warning=post.reel_warning,
        reel_template=post.reel_template,
        reel_clip_templates=post.reel_clip_templates,
        reel_brand_color=post.reel_brand_color,
        reel_title_text=post.reel_title_text,
        reel_logo_url=media_url_path(post.reel_logo_path) if post.reel_logo_path else None,
        reel_logo_x=post.reel_logo_x,
        reel_logo_y=post.reel_logo_y,
        reel_logo_scale=post.reel_logo_scale,
        reel_ctas=post.reel_ctas,
        platform=post.platform,
        social_account_id=str(post.social_account_id) if post.social_account_id else None,
        social_account_name=account_name,
        also_post_to_instagram=post.also_post_to_instagram,
        scheduled_at=post.scheduled_at,
        status=post.status,
        published_at=post.published_at,
        external_post_id=post.external_post_id,
        error_message=post.error_message,
        instagram_post_id=post.instagram_post_id,
        instagram_error=post.instagram_error,
        created_at=post.created_at,
        updated_at=post.updated_at,
    )


async def _get_owned_post(post_id: str, user: User) -> ScheduledPost:
    try:
        oid = PydanticObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")

    post = await ScheduledPost.get(oid)
    if not post or post.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


async def _account_name(post: ScheduledPost) -> str | None:
    if not post.social_account_id:
        return None
    account = await SocialAccount.get(post.social_account_id)
    return account.fb_page_name if account else None


@router.get("/reel-templates")
async def reel_templates(current_user: User = Depends(get_current_user)):
    return public_templates()


@router.get("/reel-fonts")
async def reel_fonts(current_user: User = Depends(get_current_user)):
    return public_fonts()


@router.post("", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
async def create_post(
    caption: str = Form(...),
    scheduled_at: datetime | None = Form(default=None),
    platform: Platform | None = Form(default=None),
    social_account_id: str | None = Form(default=None),
    also_post_to_instagram: bool = Form(default=False),
    media: UploadFile | None = File(default=None),
    generate_reel: bool = Form(default=False),
    reel_images: list[UploadFile] = File(default=[]),
    use_ai_video: bool = Form(default=False),
    reel_target_seconds: float = Form(default=45.0),
    reel_template: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
):
    """With generate_reel, `reel_images` may hold 0-10 images and/or videos
    (the name predates video support). With none, the reel is built from
    the caption alone; `use_ai_video` adds Hugging Face video clip(s).
    """
    if generate_reel and media is not None and media.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Don't send a media file and generate_reel together - pick one",
        )
    if not generate_reel and scheduled_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scheduled_at is required")

    account = await _resolve_social_account(social_account_id, current_user)

    media_path = None
    media_type = None
    reel_source_images = None
    reel_ai_pending = False
    post_status = PostStatus.scheduled

    if generate_reel:
        # Saved as a draft first - the video is generated in the background
        # by the scheduler (independent of this request/the compose page
        # staying open), and the user previews it and picks a time via the
        # separate /schedule action below before it actually goes live.
        reel_source_images = await _save_reel_sources(current_user.id, reel_images)
        reel_ai_pending = use_ai_video or not reel_source_images
        post_status = PostStatus.generating_video
        scheduled_at = None
    elif media is not None and media.filename:
        media_path, media_type = await _save_upload(current_user.id, media)

    post = ScheduledPost(
        user_id=current_user.id,
        caption=caption,
        media_path=media_path,
        media_type=media_type,
        reel_source_images=reel_source_images,
        reel_ai_pending=reel_ai_pending,
        reel_use_ai_video=generate_reel and use_ai_video,
        reel_target_seconds=max(MIN_NEW_REEL_SECONDS, min(reel_target_seconds, MAX_NEW_REEL_SECONDS)),
        platform=platform,
        social_account_id=account.id if account else None,
        also_post_to_instagram=also_post_to_instagram and account is not None,
        scheduled_at=scheduled_at,
        status=post_status,
    )
    if generate_reel and reel_template:
        # Source images for a text-only reel don't exist yet (AI/cards
        # fill them in later), so per-image defaults stay unset there and
        # the uniform fallback carries the template's look instead.
        await apply_template(post, reel_template)
    await post.insert()

    return _post_response(post, account.fb_page_name if account else None)


@router.get("/ai-status")
async def ai_status(current_user: User = Depends(get_current_user)):
    """Whether AI reel footage is available, so the compose page can say so."""
    return {
        "enabled": hf_media.is_enabled(),
        "video_model": settings.hf_video_model,
        "image_model": settings.hf_image_model,
        "video_clips": settings.hf_video_clips,
    }


@router.post("/{post_id}/schedule", response_model=PostResponse)
async def schedule_draft_post(
    post_id: str,
    scheduled_at: datetime = Form(...),
    current_user: User = Depends(get_current_user),
):
    """Confirms a ready reel draft (video already generated) into the normal
    scheduled/publish pipeline.
    """
    post = await _get_owned_post(post_id, current_user)

    if post.status != PostStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This post isn't a ready draft - the reel video may still be generating",
        )

    post.scheduled_at = scheduled_at
    post.status = PostStatus.scheduled
    post.updated_at = datetime.now(timezone.utc)
    await post.save()

    account_name = None
    if post.social_account_id:
        account = await SocialAccount.get(post.social_account_id)
        account_name = account.fb_page_name if account else None
    return _post_response(post, account_name)


@router.post("/{post_id}/regenerate", response_model=PostResponse)
async def regenerate_reel(
    post_id: str,
    target_seconds: float = Form(default=45.0),
    audio: UploadFile | None = File(default=None),
    audio_start: float = Form(default=0.0),
    audio_end: float | None = Form(default=None),
    remove_audio: bool = Form(default=False),
    voice_audio: UploadFile | None = File(default=None),
    voice_audio_start: float = Form(default=0.0),
    voice_audio_end: float | None = Form(default=None),
    remove_voice_audio: bool = Form(default=False),
    image_order: str = Form(default=""),
    transition: str = Form(default=DEFAULT_TRANSITION),
    zoom_style: str = Form(default=DEFAULT_ZOOM_STYLE),
    image_transitions: str = Form(default=""),
    image_zoom_styles: str = Form(default=""),
    image_durations: str = Form(default=""),
    text_layers: str = Form(default=""),
    image_text_layers: str = Form(default=""),
    image_color_filters: str = Form(default=""),
    template: str | None = Form(default=None),
    brand_color: str | None = Form(default=None),
    title_text: str | None = Form(default=None),
    logo: UploadFile | None = File(default=None),
    remove_logo: bool = Form(default=False),
    logo_x: float | None = Form(default=None),
    logo_y: float | None = Form(default=None),
    logo_scale: float | None = Form(default=None),
    ctas: str = Form(default=""),
    clip_templates: str = Form(default=""),
    new_clips: list[UploadFile] = File(default=[]),
    current_user: User = Depends(get_current_user),
):
    """Re-runs reel generation for an existing draft against its source
    clips - optionally reordered, with clips added (`new_clips`, appended
    after the existing ones in index space: index n, n+1, ...) or removed
    (left out of `image_order`) - with a new duration and/or a new custom
    audio track. `transition`/`zoom_style` are the uniform fallback;
    `image_transitions`/`image_zoom_styles`/`image_durations` (one value per
    image, in the *current pre-reorder* order - same indexing as
    `image_order`) let each image get its own zoom, its own transition into
    the next image, and its own on-screen duration (the video's total
    length is then whatever these sum to, not a fixed target).
    """
    post = await _get_owned_post(post_id, current_user)

    if not post.reel_source_images:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This post isn't a reel")
    if post.status not in (PostStatus.draft, PostStatus.generation_failed):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can't regenerate while a generation is already in progress",
        )
    if audio_end is not None and audio_end <= audio_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="audio_end must be after audio_start")
    if voice_audio_end is not None and voice_audio_end <= voice_audio_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="voice_audio_end must be after voice_audio_start"
        )
    if transition not in XFADE_TRANSITIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid transition")
    if zoom_style not in ZOOM_STYLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"zoom_style must be one of {', '.join(ZOOM_STYLES)}",
        )

    new_clips = [f for f in new_clips if f.filename]
    for clip in new_clips:
        if _media_type_for(clip.filename or "") is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported file type for a clip: {clip.filename}"
            )
    n_existing = len(post.reel_source_images)
    # Index space for everything below: existing clips, then the new ones.
    n = n_existing + len(new_clips)

    if image_order:
        try:
            order = [int(x) for x in image_order.split(",")]
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image_order")
        # A subset is fine - clips left out are removed from the reel.
        if not order or len(set(order)) != len(order) or any(not (0 <= i < n) for i in order):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="image_order must list each kept clip index once",
            )
    else:
        order = list(range(n))
    if len(order) > MAX_REEL_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"A reel can use at most {MAX_REEL_SOURCES} clips"
        )

    def _parse_per_image(raw: str, allowed: dict[str, str] | list[str], field_name: str) -> list[str] | None:
        if not raw:
            return None
        values = raw.split(",")
        if len(values) != n:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} needs {n} values")
        if any(v not in allowed for v in values):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid value in {field_name}")
        return values

    new_zoom_styles = _parse_per_image(image_zoom_styles, ZOOM_STYLES, "image_zoom_styles")
    new_transitions = _parse_per_image(image_transitions, XFADE_TRANSITIONS, "image_transitions")

    new_durations: list[float] | None = None
    if image_durations:
        try:
            parsed_durations = [float(x) for x in image_durations.split(",")]
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image_durations")
        if len(parsed_durations) != n:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"image_durations needs {n} values")
        if any(not (MIN_IMAGE_SECONDS <= d <= MAX_IMAGE_SECONDS) for d in parsed_durations):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Each image duration must be between {MIN_IMAGE_SECONDS} and {MAX_IMAGE_SECONDS} seconds",
            )
        new_durations = parsed_durations

    new_color_filters = _parse_per_image(image_color_filters, COLOR_FILTERS, "image_color_filters")
    # Per-clip template ids; "none" (or "") = use the reel's template.
    new_clip_templates = _parse_per_image(clip_templates, ["", "none", *REEL_TEMPLATE_IDS], "clip_templates")

    new_text_layers = _parse_text_layers(text_layers, "text_layers")

    new_image_text_layers: list[list[dict]] | None = None
    if image_text_layers:
        try:
            parsed_groups = json.loads(image_text_layers)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image_text_layers JSON")
        if not isinstance(parsed_groups, list) or len(parsed_groups) != n:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"image_text_layers needs a list of {n} lists",
            )
        new_image_text_layers = []
        for group in parsed_groups:
            if not isinstance(group, list):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Each image_text_layers entry must be a list"
                )
            if len(group) > MAX_TEXT_LAYERS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"At most {MAX_TEXT_LAYERS} text layers per image",
                )
            new_image_text_layers.append(normalize_text_layers(group))

    # Everything is validated - now save the new clips and apply the order.
    all_sources = list(post.reel_source_images)
    for clip in new_clips:
        path, _ = await _save_upload(current_user.id, clip)
        all_sources.append(path)
    for i in set(range(n)) - set(order):
        Path(all_sources[i]).unlink(missing_ok=True)
    post.reel_source_images = [all_sources[i] for i in order]

    # Stored per-clip settings only cover the existing clips; give the new
    # ones defaults so the "keep what's stored" fallbacks below line up.
    if new_clips:
        extra = len(new_clips)
        for attr, default in (
            ("reel_image_transitions", post.reel_transition),
            ("reel_image_zoom_styles", post.reel_zoom_style),
            ("reel_image_durations", 3.0),
            ("reel_image_text_layers", []),
            ("reel_image_color_filters", "none"),
            ("reel_clip_templates", None),
        ):
            stored = getattr(post, attr)
            if stored and len(stored) == n_existing:
                setattr(post, attr, list(stored) + [default] * extra)

    # CTAs arrive indexed by the pre-reorder clip order (like every other
    # per-image field); re-point them at the clips' new positions. "" = not
    # sent (keep, still re-pointed); "[]" = remove all.
    if ctas:
        try:
            parsed_ctas = json.loads(ctas)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ctas JSON")
        if not isinstance(parsed_ctas, list) or len(parsed_ctas) > MAX_CTAS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"ctas must be a list of at most {MAX_CTAS}"
            )
        post.reel_ctas = normalize_ctas(parsed_ctas, n)
    if post.reel_ctas:
        # A CTA whose clip was removed moves to the first clip.
        post.reel_ctas = [{**cta, "clip": order.index(cta["clip"]) if cta["clip"] in order else 0} for cta in post.reel_ctas]

    if new_zoom_styles is not None:
        post.reel_image_zoom_styles = [new_zoom_styles[i] for i in order]
    elif post.reel_image_zoom_styles and len(post.reel_image_zoom_styles) == n:
        post.reel_image_zoom_styles = [post.reel_image_zoom_styles[i] for i in order]

    if new_transitions is not None:
        post.reel_image_transitions = [new_transitions[i] for i in order]
    elif post.reel_image_transitions and len(post.reel_image_transitions) == n:
        post.reel_image_transitions = [post.reel_image_transitions[i] for i in order]

    if new_durations is not None:
        post.reel_image_durations = [new_durations[i] for i in order]
    elif post.reel_image_durations and len(post.reel_image_durations) == n:
        post.reel_image_durations = [post.reel_image_durations[i] for i in order]

    if new_image_text_layers is not None:
        post.reel_image_text_layers = [new_image_text_layers[i] for i in order]
    elif post.reel_image_text_layers and len(post.reel_image_text_layers) == n:
        post.reel_image_text_layers = [post.reel_image_text_layers[i] for i in order]

    if new_clip_templates is not None:
        picked = [t if t in REEL_TEMPLATES else None for t in (new_clip_templates[i] for i in order)]
        post.reel_clip_templates = picked if any(picked) else None
    elif post.reel_clip_templates and len(post.reel_clip_templates) == n:
        post.reel_clip_templates = [post.reel_clip_templates[i] for i in order]

    if new_color_filters is not None:
        post.reel_image_color_filters = [new_color_filters[i] for i in order]
    elif post.reel_image_color_filters and len(post.reel_image_color_filters) == n:
        post.reel_image_color_filters = [post.reel_image_color_filters[i] for i in order]

    if new_text_layers is not None:
        post.reel_text_layers = new_text_layers

    post.reel_target_seconds = max(MIN_REEL_SECONDS, min(target_seconds, MAX_REEL_SECONDS))
    post.reel_transition = transition
    post.reel_zoom_style = zoom_style

    # Template/brand: None = not sent (keep), "" = clear. The per-image
    # look was already sent explicitly above, so only the template id is
    # stored here - not its defaults, which would undo those tweaks.
    if template is not None:
        post.reel_template = template if get_template(template) else None
    if brand_color is not None and re.fullmatch(r"#[0-9a-fA-F]{6}", brand_color):
        post.reel_brand_color = brand_color
    if title_text is not None:
        post.reel_title_text = title_text.strip()[:120] or None
    if logo_x is not None:
        post.reel_logo_x = max(0.0, min(logo_x, 1.0))
    if logo_y is not None:
        post.reel_logo_y = max(0.0, min(logo_y, 1.0))
    if logo_scale is not None:
        post.reel_logo_scale = max(0.05, min(logo_scale, 0.6))
    if remove_logo and post.reel_logo_path:
        Path(post.reel_logo_path).unlink(missing_ok=True)
        post.reel_logo_path = None
    elif logo is not None and logo.filename:
        if _media_type_for(logo.filename) != MediaType.image:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The logo must be an image")
        if post.reel_logo_path:
            Path(post.reel_logo_path).unlink(missing_ok=True)
        post.reel_logo_path, _ = await _save_upload(current_user.id, logo)

    if remove_audio:
        if post.reel_audio_path:
            Path(post.reel_audio_path).unlink(missing_ok=True)
        post.reel_audio_path = None
        post.reel_audio_start_seconds = 0.0
        post.reel_audio_end_seconds = None
    elif audio is not None and audio.filename:
        if post.reel_audio_path:
            Path(post.reel_audio_path).unlink(missing_ok=True)
        post.reel_audio_path = await _save_audio_upload(current_user.id, audio)
        post.reel_audio_start_seconds = max(0.0, audio_start)
        post.reel_audio_end_seconds = audio_end
    elif post.reel_audio_path:
        # Keeping the existing audio - only its start/end trim changed.
        post.reel_audio_start_seconds = max(0.0, audio_start)
        post.reel_audio_end_seconds = audio_end

    if remove_voice_audio:
        if post.reel_voice_audio_path:
            Path(post.reel_voice_audio_path).unlink(missing_ok=True)
        post.reel_voice_audio_path = None
        post.reel_voice_audio_start_seconds = 0.0
        post.reel_voice_audio_end_seconds = None
    elif voice_audio is not None and voice_audio.filename:
        if post.reel_voice_audio_path:
            Path(post.reel_voice_audio_path).unlink(missing_ok=True)
        post.reel_voice_audio_path = await _save_audio_upload(current_user.id, voice_audio)
        post.reel_voice_audio_start_seconds = max(0.0, voice_audio_start)
        post.reel_voice_audio_end_seconds = voice_audio_end
    elif post.reel_voice_audio_path:
        post.reel_voice_audio_start_seconds = max(0.0, voice_audio_start)
        post.reel_voice_audio_end_seconds = voice_audio_end

    post.status = PostStatus.generating_video
    post.error_message = None
    post.updated_at = datetime.now(timezone.utc)
    await post.save()

    account_name = None
    if post.social_account_id:
        account = await SocialAccount.get(post.social_account_id)
        account_name = account.fb_page_name if account else None
    return _post_response(post, account_name)


@router.post("/{post_id}/ai-edit", response_model=AIEditResponse)
async def ai_edit_reel(
    post_id: str,
    instruction: str = Form(...),
    current_user: User = Depends(get_current_user),
):
    """Applies a plain-language change ("make it faster", "add 'Sale' at
    the top") to a reel draft's settings, then re-renders it."""
    post = await _get_owned_post(post_id, current_user)

    if not post.reel_source_images:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This post isn't a reel")
    if post.status not in (PostStatus.draft, PostStatus.generation_failed):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Wait for the current generation to finish first",
        )
    if not instruction.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Say what you'd like changed")

    n = len(post.reel_source_images)
    current = {
        "template": post.reel_template or "none",
        "transition": post.reel_transition,
        "zoom_style": post.reel_zoom_style,
        "color_filters": post.reel_image_color_filters or ["none"] * n,
        "target_seconds": post.reel_target_seconds,
        "clip_count": n,
        "text_layers": post.reel_text_layers,
        "title_text": post.reel_title_text,
        "ctas": post.reel_ctas or [],
        "brand_color": post.reel_brand_color,
        "caption": post.caption[:500],
    }
    try:
        patch, reply = await ai_editor.propose_edit(instruction, current)
    except ai_editor.AIEditError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    if "template" in patch:
        await apply_template(post, patch["template"])
    if "transition" in patch:
        post.reel_transition = patch["transition"]
        post.reel_image_transitions = [patch["transition"]] * n
    if "zoom_style" in patch:
        post.reel_zoom_style = patch["zoom_style"]
        post.reel_image_zoom_styles = [patch["zoom_style"]] * n
    if "color_filter" in patch:
        post.reel_image_color_filters = [patch["color_filter"]] * n
    if "target_seconds" in patch:
        post.reel_target_seconds = patch["target_seconds"]
        post.reel_image_durations = None  # re-split evenly across the new length
    if "text_layers" in patch:
        post.reel_text_layers = patch["text_layers"]
    if "title_text" in patch:
        post.reel_title_text = patch["title_text"]
    if "ctas" in patch:
        post.reel_ctas = normalize_ctas(patch["ctas"], n)
    if "brand_color" in patch:
        post.reel_brand_color = patch["brand_color"]

    if patch:
        post.status = PostStatus.generating_video
        post.error_message = None
        post.updated_at = datetime.now(timezone.utc)
        await post.save()

    return AIEditResponse(
        post=_post_response(post, await _account_name(post)),
        reply=reply,
        changed=sorted(patch),
    )


@router.get("", response_model=PaginatedPosts)
async def list_posts(
    status_filter: PostStatus | None = None,
    page: int = 1,
    page_size: int = 10,
    current_user: User = Depends(get_current_user),
):
    page = max(page, 1)
    page_size = max(1, min(page_size, 100))

    query = ScheduledPost.find(ScheduledPost.user_id == current_user.id)
    if status_filter is not None:
        query = query.find(ScheduledPost.status == status_filter)

    total = await query.count()
    total_pages = max(1, (total + page_size - 1) // page_size)

    # Most-recently-created first, so a just-created draft (which has no
    # scheduled_at yet) shows up at the top instead of sorting to the bottom.
    posts = (
        await query.sort(-ScheduledPost.created_at)
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )

    accounts = await SocialAccount.find(SocialAccount.user_id == current_user.id).to_list()
    account_names = {a.id: a.fb_page_name for a in accounts}

    items = [
        _post_response(p, account_names.get(p.social_account_id) if p.social_account_id else None)
        for p in posts
    ]

    return PaginatedPosts(items=items, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.get("/{post_id}", response_model=PostResponse)
async def get_post(post_id: str, current_user: User = Depends(get_current_user)):
    post = await _get_owned_post(post_id, current_user)
    account_name = None
    if post.social_account_id:
        account = await SocialAccount.get(post.social_account_id)
        account_name = account.fb_page_name if account else None
    return _post_response(post, account_name)


@router.put("/{post_id}", response_model=PostResponse)
async def update_post(
    post_id: str,
    caption: str = Form(...),
    scheduled_at: datetime = Form(...),
    platform: Platform | None = Form(default=None),
    social_account_id: str | None = Form(default=None),
    also_post_to_instagram: bool = Form(default=False),
    media: UploadFile | None = File(default=None),
    current_user: User = Depends(get_current_user),
):
    post = await _get_owned_post(post_id, current_user)
    was_scheduled = post.status == PostStatus.scheduled

    account = await _resolve_social_account(social_account_id, current_user)

    post.caption = caption
    post.scheduled_at = scheduled_at
    post.platform = platform
    post.social_account_id = account.id if account else None
    post.also_post_to_instagram = also_post_to_instagram and account is not None

    if media is not None and media.filename:
        old_media_path = post.media_path
        media_path, media_type = await _save_upload(current_user.id, media)
        post.media_path = media_path
        post.media_type = media_type
        if old_media_path:
            Path(old_media_path).unlink(missing_ok=True)

    if not was_scheduled:
        # Editing a published/failed post re-arms it for another publish
        # attempt at the new time. Clear the previous attempt's result -
        # any Facebook/Instagram post already made stays live as-is, this
        # just describes a fresh attempt going forward.
        post.status = PostStatus.scheduled
        post.published_at = None
        post.external_post_id = None
        post.error_message = None
        post.instagram_post_id = None
        post.instagram_error = None

    post.updated_at = datetime.now(timezone.utc)
    await post.save()

    return _post_response(post, account.fb_page_name if account else None)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(post_id: str, current_user: User = Depends(get_current_user)):
    post = await _get_owned_post(post_id, current_user)
    if post.media_path:
        Path(post.media_path).unlink(missing_ok=True)
    for image_path in post.reel_source_images or []:
        Path(image_path).unlink(missing_ok=True)
    if post.reel_audio_path:
        Path(post.reel_audio_path).unlink(missing_ok=True)
    if post.reel_voice_audio_path:
        Path(post.reel_voice_audio_path).unlink(missing_ok=True)
    if post.reel_logo_path:
        Path(post.reel_logo_path).unlink(missing_ok=True)
    await post.delete()
