from beanie import init_beanie
from pymongo import AsyncMongoClient

from app.core.config import settings
from app.models.post import ScheduledPost
from app.models.social_account import SocialAccount
from app.models.user import User

client: AsyncMongoClient | None = None


async def init_db() -> None:
    global client
    client = AsyncMongoClient(settings.mongodb_url)
    await init_beanie(
        database=client[settings.mongodb_db_name],
        document_models=[User, ScheduledPost, SocialAccount],
    )
