from datetime import datetime, timezone
from enum import Enum

from beanie import Document, Indexed, PydanticObjectId
from pydantic import Field
from typing_extensions import Annotated


class ConnectionStatus(str, Enum):
    active = "active"
    needs_reauth = "needs_reauth"


class SocialAccount(Document):
    user_id: Annotated[PydanticObjectId, Indexed()]

    fb_page_id: str
    fb_page_name: str
    page_access_token_encrypted: str

    long_lived_user_token_encrypted: str
    long_lived_token_expires_at: datetime

    instagram_business_account_id: str | None = None
    instagram_username: str | None = None

    status: ConnectionStatus = ConnectionStatus.active
    last_error: str | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "social_accounts"
