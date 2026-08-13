import logging
from datetime import datetime, timedelta, timezone

from app.core.crypto import decrypt_token, encrypt_token
from app.models.social_account import ConnectionStatus, SocialAccount
from app.services import facebook

logger = logging.getLogger("scheduler.token_refresh")

REFRESH_WINDOW = timedelta(days=10)


async def refresh_due_accounts() -> None:
    threshold = datetime.now(timezone.utc) + REFRESH_WINDOW

    due_accounts = await SocialAccount.find(
        SocialAccount.status == ConnectionStatus.active,
        SocialAccount.long_lived_token_expires_at <= threshold,
    ).to_list()

    for account in due_accounts:
        try:
            current_user_token = decrypt_token(account.long_lived_user_token_encrypted)
            refreshed = await facebook.exchange_for_long_lived_token(current_user_token)
            new_user_token = refreshed["access_token"]
            expires_in = refreshed.get("expires_in", 60 * 24 * 60 * 60)

            pages = await facebook.get_pages(new_user_token)
            page = next((p for p in pages if p["id"] == account.fb_page_id), None)
            if page is None:
                raise facebook.FacebookAPIError("Page no longer accessible with refreshed token")

            account.page_access_token_encrypted = encrypt_token(page["access_token"])
            account.long_lived_user_token_encrypted = encrypt_token(new_user_token)
            account.long_lived_token_expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=expires_in
            )
            account.status = ConnectionStatus.active
            account.last_error = None
            account.updated_at = datetime.now(timezone.utc)
            await account.save()
            logger.info("Refreshed token for social account %s", account.id)
        except Exception as exc:
            logger.warning("Failed to refresh social account %s: %s", account.id, exc)
            account.status = ConnectionStatus.needs_reauth
            account.last_error = str(exc)
            account.updated_at = datetime.now(timezone.utc)
            await account.save()
