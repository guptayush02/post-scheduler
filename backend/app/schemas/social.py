from pydantic import BaseModel

from app.models.social_account import ConnectionStatus
from app.schemas.post import UtcDatetime


class SocialAccountResponse(BaseModel):
    id: str
    fb_page_id: str
    fb_page_name: str
    instagram_username: str | None
    status: ConnectionStatus
    last_error: str | None
    created_at: UtcDatetime
    updated_at: UtcDatetime
