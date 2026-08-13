from beanie import PydanticObjectId
from fastapi import Cookie, HTTPException, status

from app.core.security import decode_access_token
from app.models.user import User


async def get_current_user(session_token: str | None = Cookie(default=None)) -> User:
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    if not session_token:
        raise unauthorized

    user_id = decode_access_token(session_token)
    if not user_id:
        raise unauthorized

    user = await User.get(PydanticObjectId(user_id))
    if not user:
        raise unauthorized

    return user
