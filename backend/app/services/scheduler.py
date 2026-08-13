import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.crypto import decrypt_token
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


async def publish_post(post: ScheduledPost) -> None:
    """Publishes a due post. Facebook Page posts (text/image/video) go live
    for real. Instagram publishing isn't wired up yet — it needs the local
    media file to be reachable via a public HTTPS URL (e.g. ngrok), which
    Instagram's Content Publishing API requires and Facebook's doesn't.
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
            "Instagram publishing requires the media to be served over a public HTTPS URL "
            "(e.g. via ngrok) - not configured yet"
        )

    external_post_id = await _publish_to_facebook(post, account)

    post.status = PostStatus.published
    post.published_at = datetime.now(timezone.utc)
    post.external_post_id = external_post_id
    await post.save()
    logger.info("Published post %s to Facebook Page %s (%s)", post.id, account.fb_page_id, external_post_id)


async def poll_due_posts() -> None:
    due_posts = await ScheduledPost.find(
        ScheduledPost.status == PostStatus.scheduled,
        ScheduledPost.scheduled_at <= datetime.now(timezone.utc),
    ).to_list()

    for post in due_posts:
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
