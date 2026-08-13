from datetime import datetime, timezone

from beanie import Document, Indexed
from pydantic import EmailStr, Field
from typing_extensions import Annotated


class User(Document):
    email: Annotated[EmailStr, Indexed(unique=True)]
    hashed_password: str
    is_verified: bool = False
    verification_token: str | None = None
    verification_token_expires: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "users"
