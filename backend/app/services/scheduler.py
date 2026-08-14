import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from beanie.operators import Set

from app.core.config import settings
from app.core.crypto import decrypt_token
from app.core.media import media_url_path
from app.models.post import MediaType, Platform, PostStatus, ScheduledPost
from app.models.social_account import ConnectionStatus, SocialAccount
from app.services import facebook
from app.services.token_refresh import refresh_due_accounts

logger = logging.getLogger("scheduler.worker")

scheduler = AsyncIOScheduler()


class PublishError(Exception):
    pass


async def _publish_to_facebook(post: ScheduledPost, account: SocialAccount) -> str:
    page_token = decrypt_token(account.page_access_token_encrypted)

    try:
        if post.media_type == MediaType.image and post.media_path:
            result = await facebook.publish_page_photo(
                account.fb_page_id, page_token, post.caption, post.media_path
            )
        elif post.media_type == MediaType.video and post.media_path:
            result = await facebook.publish_page_video(
                account.fb_page_id, page_token, post.caption, post.media_path
            )
        else:
            result = await facebook.publish_page_feed(account.fb_page_id, page_token, post.caption)
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
            post.caption,
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


def start_scheduler() -> None:
    scheduler.add_job(poll_due_posts, "interval", seconds=60, id="poll_due_posts")
    scheduler.add_job(refresh_due_accounts, "interval", hours=24, id="refresh_social_tokens")
    scheduler.start()


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
