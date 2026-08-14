import logging
import secrets
from datetime import datetime, timedelta, timezone

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.crypto import encrypt_token
from app.core.deps import get_current_user
from app.core.security import decode_access_token
from app.models.social_account import ConnectionStatus, SocialAccount
from app.models.user import User
from app.schemas.social import SocialAccountResponse
from app.services import facebook

router = APIRouter(prefix="/api/social", tags=["social"])
logger = logging.getLogger("scheduler.social")

STATE_COOKIE_NAME = "fb_oauth_state"
STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60


def _account_response(account: SocialAccount) -> SocialAccountResponse:
    return SocialAccountResponse(
        id=str(account.id),
        fb_page_id=account.fb_page_id,
        fb_page_name=account.fb_page_name,
        instagram_username=account.instagram_username,
        status=account.status,
        last_error=account.last_error,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def _error_redirect(reason: str) -> RedirectResponse:
    redirect = RedirectResponse(url=f"{settings.frontend_base_url}/connections?error={reason}")
    redirect.delete_cookie(STATE_COOKIE_NAME)
    return redirect


@router.get("/accounts", response_model=list[SocialAccountResponse])
async def list_accounts(current_user: User = Depends(get_current_user)):
    accounts = await SocialAccount.find(SocialAccount.user_id == current_user.id).to_list()
    return [_account_response(a) for a in accounts]


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_account(account_id: str, current_user: User = Depends(get_current_user)):
    try:
        oid = PydanticObjectId(account_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    account = await SocialAccount.get(oid)
    if not account or account.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    await account.delete()


@router.get("/facebook/connect")
async def facebook_connect(current_user: User = Depends(get_current_user)):
    state = secrets.token_urlsafe(24)
    oauth_url = facebook.build_oauth_url(state)

    redirect = RedirectResponse(url=oauth_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    redirect.set_cookie(
        key=STATE_COOKIE_NAME,
        value=state,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=STATE_COOKIE_MAX_AGE_SECONDS,
    )
    return redirect


@router.get("/facebook/callback")
async def facebook_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error:
        return _error_redirect("facebook_denied")

    cookie_state = request.cookies.get(STATE_COOKIE_NAME)
    if not state or not cookie_state or state != cookie_state:
        return _error_redirect("invalid_state")

    if not code:
        return _error_redirect("missing_code")

    session_token = request.cookies.get("session_token")
    user_id = decode_access_token(session_token) if session_token else None
    current_user = await User.get(PydanticObjectId(user_id)) if user_id else None
    if not current_user:
        return _error_redirect("not_authenticated")

    try:
        short_lived = await facebook.exchange_code_for_user_token(code)
        long_lived = await facebook.exchange_for_long_lived_token(short_lived["access_token"])
        user_token = long_lived["access_token"]
        expires_in = long_lived.get("expires_in", 60 * 24 * 60 * 60)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        pages = await facebook.get_pages(user_token)
        logger.info("Facebook OAuth callback for user %s: %d page(s) returned", current_user.id, len(pages))

        if not pages:
            return _error_redirect("no_pages_found")

        for page in pages:
            page_id = page["id"]
            page_token = page["access_token"]
            ig_account = await facebook.get_linked_instagram(page_id, page_token)

            existing = await SocialAccount.find_one(
                SocialAccount.user_id == current_user.id,
                SocialAccount.fb_page_id == page_id,
            )

            if existing:
                existing.fb_page_name = page.get("name", existing.fb_page_name)
                existing.page_access_token_encrypted = encrypt_token(page_token)
                existing.long_lived_user_token_encrypted = encrypt_token(user_token)
                existing.long_lived_token_expires_at = expires_at
                existing.instagram_business_account_id = ig_account["id"] if ig_account else None
                existing.instagram_username = ig_account["username"] if ig_account else None
                existing.status = ConnectionStatus.active
                existing.last_error = None
                existing.updated_at = datetime.now(timezone.utc)
                await existing.save()
            else:
                await SocialAccount(
                    user_id=current_user.id,
                    fb_page_id=page_id,
                    fb_page_name=page.get("name", ""),
                    page_access_token_encrypted=encrypt_token(page_token),
                    long_lived_user_token_encrypted=encrypt_token(user_token),
                    long_lived_token_expires_at=expires_at,
                    instagram_business_account_id=ig_account["id"] if ig_account else None,
                    instagram_username=ig_account["username"] if ig_account else None,
                ).insert()
    except facebook.FacebookAPIError as exc:
        logger.warning("Facebook OAuth callback failed for user %s: %s", current_user.id, exc)
        return _error_redirect("facebook_api_error")

    success = RedirectResponse(url=f"{settings.frontend_base_url}/connections?connected=1")
    success.delete_cookie(STATE_COOKIE_NAME)
    return success
