import uuid
from datetime import datetime, timezone
from pathlib import Path

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.media import media_url_path
from app.models.post import MediaType, Platform, PostStatus, ScheduledPost
from app.models.social_account import SocialAccount
from app.models.user import User
from app.schemas.post import PaginatedPosts, PostResponse

router = APIRouter(prefix="/api/posts", tags=["posts"])

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}


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


@router.post("", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
async def create_post(
    caption: str = Form(...),
    scheduled_at: datetime = Form(...),
    platform: Platform | None = Form(default=None),
    social_account_id: str | None = Form(default=None),
    also_post_to_instagram: bool = Form(default=False),
    media: UploadFile | None = File(default=None),
    current_user: User = Depends(get_current_user),
):
    account = await _resolve_social_account(social_account_id, current_user)

    media_path = None
    media_type = None
    if media is not None and media.filename:
        media_path, media_type = await _save_upload(current_user.id, media)

    post = ScheduledPost(
        user_id=current_user.id,
        caption=caption,
        media_path=media_path,
        media_type=media_type,
        platform=platform,
        social_account_id=account.id if account else None,
        also_post_to_instagram=also_post_to_instagram and account is not None,
        scheduled_at=scheduled_at,
    )
    await post.insert()

    return _post_response(post, account.fb_page_name if account else None)


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

    posts = (
        await query.sort(-ScheduledPost.scheduled_at)
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
    await post.delete()
