"""Fills in a reel's source segments before its first render: optional AI
video clips (Hugging Face), and for a text-only reel, scene images to carry
the rest of the 30-60s - AI-generated when possible, plain title cards
otherwise, so a reel always comes out even with no token or no credits.
"""

import logging
import uuid
from pathlib import Path

from app.core.config import settings
from app.models.post import ScheduledPost
from app.services import hf_media
from app.services.reel_generator import is_video_path, render_title_cards

logger = logging.getLogger("scheduler.reel_assets")

MAX_PROMPT_CHARS = 400

# Varied framings so the generated stills don't all look the same.
_SCENE_STYLES = [
    "cinematic wide establishing shot",
    "close-up detail shot, shallow depth of field",
    "vibrant lifestyle photo, natural light",
    "aesthetic minimal composition, soft colors",
    "dynamic angle, dramatic lighting",
    "flat lay top-down photo",
]


def _prompt(caption: str) -> str:
    return " ".join(caption.split())[:MAX_PROMPT_CHARS]


async def prepare_reel_sources(post: ScheduledPost) -> list[str]:
    """Updates post.reel_source_images in place (not saved) and returns
    warnings to show the user. Never raises for AI failures - those degrade
    to the non-AI path."""
    user_dir = Path(settings.uploads_dir) / str(post.user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    def new_path(ext: str) -> str:
        return str((user_dir / f"{uuid.uuid4().hex}{ext}").as_posix())

    sources = list(post.reel_source_images or [])
    prompt = _prompt(post.caption)
    warnings: list[str] = []

    clips: list[str] = []
    if post.reel_use_ai_video:
        if not hf_media.is_enabled():
            warnings.append("AI video skipped: HF_TOKEN isn't set on the server")
        else:
            first_image = next((p for p in sources if not is_video_path(p)), None)
            for i in range(max(0, settings.hf_video_clips)):
                out = new_path(".mp4")
                try:
                    if i == 0 and first_image:
                        # Animate the user's own first image so the clip
                        # matches their content; not every provider serves
                        # image-to-video, so fall back to text-to-video.
                        try:
                            await hf_media.image_to_video(first_image, prompt, out)
                        except hf_media.HFMediaError as exc:
                            logger.info("image-to-video failed for post %s, trying text-to-video: %s", post.id, exc)
                            await hf_media.text_to_video(prompt, out)
                    else:
                        style = _SCENE_STYLES[i % len(_SCENE_STYLES)]
                        await hf_media.text_to_video(f"{prompt}. {style}", out)
                    clips.append(out)
                except hf_media.HFMediaError as exc:
                    Path(out).unlink(missing_ok=True)
                    warnings.append(f"AI video skipped: {exc}")
                    break

    if not sources:
        stills: list[str] = []
        if hf_media.is_enabled():
            for i in range(max(0, settings.hf_scene_images)):
                out = new_path(".jpg")
                try:
                    await hf_media.text_to_image(f"{prompt}. {_SCENE_STYLES[i % len(_SCENE_STYLES)]}", out)
                    stills.append(out)
                except hf_media.HFMediaError as exc:
                    Path(out).unlink(missing_ok=True)
                    warnings.append(f"AI images skipped: {exc}")
                    break

        if not stills:
            # Even with an AI clip, a lone ~5s clip looped for 45s looks
            # broken - pad it out with cards.
            stills = render_title_cards(post.caption, str(user_dir))
            # The cards already carry the caption - don't burn it in twice.
            if post.reel_text_layers is None:
                post.reel_text_layers = []
        sources = stills

    post.reel_source_images = clips + sources
    return warnings
