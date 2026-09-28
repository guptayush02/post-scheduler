import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from beanie.operators import Set

from app.core.config import settings
from app.core.crypto import decrypt_token
from app.core.media import media_url_path, resolve_media_path
from app.models.post import MediaType, Platform, PostStatus, ScheduledPost
from app.models.social_account import ConnectionStatus, SocialAccount
from app.services import facebook
from app.services.reel_assets import prepare_reel_sources
from app.services.reel_generator import generate_reel_video
from app.services.reel_templates import apply_template, get_template
from app.services.token_refresh import refresh_due_accounts

logger = logging.getLogger("scheduler.worker")

scheduler = AsyncIOScheduler()


class PublishError(Exception):
    pass


def _caption_for_publish(post: ScheduledPost) -> str:
    """The post text as published: the caption, plus the reel's call-to-
    action links (a video can't carry a clickable link itself) and the
    music credit its license requires."""
    lines = [f"{cta['text']}: {cta['link']}" for cta in post.reel_ctas or [] if cta.get("link")]
    # CC BY music from the free library must be credited.
    credit = (post.reel_music_track or {}).get("credit")
    if credit:
        lines.append(credit)
    if not lines:
        return post.caption
    return post.caption.rstrip() + "\n\n" + "\n".join(dict.fromkeys(lines))


async def _publish_to_facebook(post: ScheduledPost, account: SocialAccount) -> str:
    page_token = decrypt_token(account.page_access_token_encrypted)
    caption = _caption_for_publish(post)

    try:
        if post.media_type == MediaType.image and post.media_path:
            result = await facebook.publish_page_photo(
                account.fb_page_id, page_token, caption, post.media_path
            )
        elif post.media_type == MediaType.video and post.media_path:
            result = await facebook.publish_page_video(
                account.fb_page_id, page_token, caption, post.media_path
            )
        else:
            result = await facebook.publish_page_feed(account.fb_page_id, page_token, caption)
    except facebook.FacebookAPIError as exc:
        if exc.is_auth_error:
            account.status = ConnectionStatus.needs_reauth
            account.last_error = str(exc)
            account.updated_at = datetime.now(timezone.utc)
            await account.save()
        raise PublishError(str(exc)) from exc

    return result.get("id") or result.get("post_id") or ""


async def _publish_to_instagram(post: ScheduledPost, account: SocialAccount) -> tuple[str | None, str | None]:
    """Best-effort Instagram cross-post. Never raises - returns
    (instagram_post_id, instagram_error), exactly one of which is set.
    """
    if not account.instagram_business_account_id:
        return None, "This account has no linked Instagram professional account"

    if not post.media_path:
        return None, "Instagram requires an image or video (text-only posts aren't supported)"

    if not settings.public_base_url:
        return None, "Public media URL not configured yet (set PUBLIC_BASE_URL, e.g. an ngrok URL)"

    media_url = f"{settings.public_base_url.rstrip('/')}{media_url_path(post.media_path)}"
    page_token = decrypt_token(account.page_access_token_encrypted)

    try:
        media_id = await facebook.publish_to_instagram(
            account.instagram_business_account_id,
            page_token,
            _caption_for_publish(post),
            media_url,
            is_video=post.media_type == MediaType.video,
        )
        return media_id, None
    except facebook.FacebookAPIError as exc:
        if exc.is_auth_error:
            account.status = ConnectionStatus.needs_reauth
            account.last_error = str(exc)
            account.updated_at = datetime.now(timezone.utc)
            await account.save()
        return None, str(exc)[:500]


async def publish_post(post: ScheduledPost) -> None:
    """Publishes a due post to its connected Facebook Page, then (if
    requested) also cross-posts to the linked Instagram account. Facebook is
    the required/primary target; Instagram is best-effort and tracked
    separately (instagram_post_id / instagram_error) so a failure there
    doesn't flip the whole post to "failed" when Facebook succeeded.
    """
    if not post.social_account_id:
        raise PublishError("No connected account was selected for this post")

    account = await SocialAccount.get(post.social_account_id)
    if not account or account.user_id != post.user_id:
        raise PublishError("The connected account for this post no longer exists")

    if account.status != ConnectionStatus.active:
        raise PublishError("Connected account needs to be reconnected (token invalid)")

    if post.platform in (Platform.instagram_post, Platform.instagram_reel):
        raise PublishError(
            "Instagram-only publishing isn't supported - connect a Facebook Page post and "
            "use the 'also post to Instagram' option instead"
        )

    external_post_id = await _publish_to_facebook(post, account)

    post.status = PostStatus.published
    post.published_at = datetime.now(timezone.utc)
    post.external_post_id = external_post_id
    logger.info("Published post %s to Facebook Page %s (%s)", post.id, account.fb_page_id, external_post_id)

    if post.also_post_to_instagram:
        post.instagram_post_id, post.instagram_error = await _publish_to_instagram(post, account)
        if post.instagram_error:
            logger.warning("Instagram cross-post failed for post %s: %s", post.id, post.instagram_error)
        else:
            logger.info("Cross-posted post %s to Instagram (%s)", post.id, post.instagram_post_id)

    await post.save()


async def poll_due_posts() -> None:
    due_posts = await ScheduledPost.find(
        ScheduledPost.status == PostStatus.scheduled,
        ScheduledPost.scheduled_at <= datetime.now(timezone.utc),
    ).to_list()

    for post in due_posts:
        # Atomically claim the post before publishing: if this update matches
        # zero documents, another scheduler instance (or an overlapping run)
        # already claimed it, so skip it here. This is what prevents the
        # same post from being published twice if the backend is ever
        # accidentally running as more than one process.
        claim = await ScheduledPost.find_one(
            ScheduledPost.id == post.id,
            ScheduledPost.status == PostStatus.scheduled,
        ).update(Set({ScheduledPost.status: PostStatus.processing}))

        if claim.modified_count == 0:
            continue

        post.status = PostStatus.processing

        try:
            await publish_post(post)
        except Exception as exc:
            logger.warning("Failed to publish post %s: %s", post.id, exc)
            post.status = PostStatus.failed
            post.error_message = str(exc)[:500]
            await post.save()


def _reel_sources_on_this_machine(post: ScheduledPost) -> bool:
    """Local dev and production can share one database while each keeps
    uploads on its own disk, so each must only render reels whose files it
    actually has - otherwise they steal each other's jobs and fail with
    "file does not exist"."""
    return all(resolve_media_path(p).is_file() for p in post.reel_source_images or [])


async def poll_pending_reels() -> None:
    # Runs entirely server-side on this interval regardless of whether the
    # user has the compose page open - generation is never tied to a
    # request/browser session.
    pending = await ScheduledPost.find(
        ScheduledPost.status == PostStatus.generating_video,
    ).to_list()

    for post in pending:
        if not _reel_sources_on_this_machine(post):
            logger.debug("Skipping reel %s: its source files aren't on this machine", post.id)
            continue

        # Same atomic-claim pattern as poll_due_posts, so an overlapping run
        # (or a second backend instance) never generates the same post twice.
        claim = await ScheduledPost.find_one(
            ScheduledPost.id == post.id,
            ScheduledPost.status == PostStatus.generating_video,
        ).update(Set({ScheduledPost.status: PostStatus.processing}))

        if claim.modified_count == 0:
            continue

        # Keep the in-memory copy in step with the claim - the mid-run save
        # below must not flip it back to generating_video.
        post.status = PostStatus.processing

        try:
            user_dir = Path(settings.uploads_dir) / str(post.user_id)
            user_dir.mkdir(parents=True, exist_ok=True)
            out_path = str((user_dir / f"{uuid.uuid4().hex}.mp4").as_posix())
            previous_media_path = post.media_path  # set when this is a regenerate, not a first run

            asset_warnings: list[str] = []
            if post.reel_ai_pending:
                logger.info("Preparing reel footage for post %s", post.id)
                asset_warnings = await prepare_reel_sources(post)
                # A template picked before the clips existed (text-only
                # reel) still needs its per-clip rhythm applied.
                if post.reel_template and not post.reel_image_transitions:
                    await apply_template(post, post.reel_template)
                # Persist straight away so a failed render (or a regenerate)
                # reuses this footage rather than generating/billing it again.
                post.reel_ai_pending = False
                await post.save()

            n = len(post.reel_source_images or [])
            zoom_styles = (
                post.reel_image_zoom_styles
                if post.reel_image_zoom_styles and len(post.reel_image_zoom_styles) == n
                else [post.reel_zoom_style] * n
            )
            transitions = (
                post.reel_image_transitions
                if post.reel_image_transitions and len(post.reel_image_transitions) == n
                else [post.reel_transition] * n
            )
            image_durations = (
                post.reel_image_durations
                if post.reel_image_durations and len(post.reel_image_durations) == n
                else None
            )

            logger.info("Generating reel video for post %s from %d segments", post.id, n)
            warnings = await generate_reel_video(
                post.reel_source_images or [],
                post.caption,
                out_path,
                image_durations=image_durations,
                target_seconds=post.reel_target_seconds,
                audio_path=post.reel_audio_path,
                audio_start=post.reel_audio_start_seconds,
                audio_end=post.reel_audio_end_seconds,
                voice_audio_path=post.reel_voice_audio_path,
                voice_audio_start=post.reel_voice_audio_start_seconds,
                voice_audio_end=post.reel_voice_audio_end_seconds,
                transitions=transitions,
                zoom_styles=zoom_styles,
                color_filters=(
                    post.reel_image_color_filters
                    if post.reel_image_color_filters and len(post.reel_image_color_filters) == n
                    # A text-only reel picks its template before its images
                    # exist, so fall back to the template's grade.
                    else [get_template(post.reel_template)["color_filter"]] * n
                    if get_template(post.reel_template)
                    else None
                ),
                text_layers=post.reel_text_layers,
                template_id=post.reel_template,
                brand={
                    "color": post.reel_brand_color,
                    "title": post.reel_title_text,
                    # Outro card text: the first call to action.
                    "outro": (post.reel_ctas or [{}])[0].get("text"),
                    "logo_path": post.reel_logo_path,
                    "logo_x": post.reel_logo_x,
                    "logo_y": post.reel_logo_y,
                    "logo_scale": post.reel_logo_scale,
                },
                ctas=post.reel_ctas,
                effects=(
                    post.reel_image_effects
                    if post.reel_image_effects and len(post.reel_image_effects) == n
                    else [get_template(post.reel_template).get("effect", "none")] * n
                    if get_template(post.reel_template)
                    else None
                ),
                clip_templates=(
                    post.reel_clip_templates
                    if post.reel_clip_templates and len(post.reel_clip_templates) == n
                    else None
                ),
                image_text_layers=(
                    post.reel_image_text_layers
                    if post.reel_image_text_layers and len(post.reel_image_text_layers) == n
                    else None
                ),
            )

            # Ready, but not live yet - the user still has to preview it and
            # confirm a schedule via POST /{id}/schedule.
            post.media_path = out_path
            post.media_type = MediaType.video
            all_warnings = asset_warnings + warnings
            post.reel_warning = "; ".join(all_warnings) if all_warnings else None
            post.status = PostStatus.draft
            post.error_message = None
            await post.save()
            if previous_media_path and previous_media_path != out_path:
                Path(previous_media_path).unlink(missing_ok=True)
            logger.info("Reel video ready for post %s: %s", post.id, out_path)
        except Exception as exc:
            logger.warning("Reel generation failed for post %s: %s", post.id, exc)
            post.status = PostStatus.generation_failed
            post.error_message = str(exc)[:500]
            await post.save()


def start_scheduler() -> None:
    scheduler.add_job(poll_due_posts, "interval", seconds=60, id="poll_due_posts")
    scheduler.add_job(poll_pending_reels, "interval", seconds=15, id="poll_pending_reels")
    scheduler.add_job(refresh_due_accounts, "interval", hours=24, id="refresh_social_tokens")
    scheduler.start()


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
