import asyncio
from pathlib import Path
from urllib.parse import urlencode

import httpx

from app.core.config import settings

INSTAGRAM_CONTAINER_POLL_INTERVAL_SECONDS = 2
INSTAGRAM_CONTAINER_MAX_POLLS = 30


class FacebookAPIError(Exception):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code

    @property
    def is_auth_error(self) -> bool:
        # 190 = OAuthException (invalid/expired token), 102/463/467 = session issues.
        return self.code in (190, 102, 463, 467)


def _graph_url(path: str) -> str:
    return f"https://graph.facebook.com/{settings.fb_graph_version}/{path}"


def _raise_for_error(data: dict) -> None:
    error = data.get("error")
    if error:
        raise FacebookAPIError(error.get("message", "Facebook API error"), code=error.get("code"))


def build_oauth_url(state: str) -> str:
    params = {
        "client_id": settings.fb_app_id or "",
        "redirect_uri": settings.fb_oauth_redirect_uri,
        "state": state,
        "scope": settings.fb_oauth_scopes,
        "response_type": "code",
    }
    return f"https://www.facebook.com/{settings.fb_graph_version}/dialog/oauth?{urlencode(params)}"


async def _get(path: str, params: dict) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(_graph_url(path), params=params)
    data = resp.json()
    _raise_for_error(data)
    return data


async def _post_form(path: str, data: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(_graph_url(path), data=data)
    body = resp.json()
    _raise_for_error(body)
    return body


async def _post_multipart(path: str, data: dict, file_path: str, file_field: str) -> dict:
    with open(file_path, "rb") as f:
        files = {file_field: (Path(file_path).name, f)}
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(_graph_url(path), data=data, files=files)
    body = resp.json()
    _raise_for_error(body)
    return body


async def exchange_code_for_user_token(code: str) -> dict:
    """Returns {access_token, token_type, expires_in} for a short-lived user token."""
    return await _get(
        "oauth/access_token",
        {
            "client_id": settings.fb_app_id,
            "redirect_uri": settings.fb_oauth_redirect_uri,
            "client_secret": settings.fb_app_secret,
            "code": code,
        },
    )


async def exchange_for_long_lived_token(short_lived_or_current_token: str) -> dict:
    """Exchanges a short-lived (or still-valid long-lived) user token for a
    fresh long-lived one (~60 days). Returns {access_token, token_type, expires_in}.
    """
    return await _get(
        "oauth/access_token",
        {
            "grant_type": "fb_exchange_token",
            "client_id": settings.fb_app_id,
            "client_secret": settings.fb_app_secret,
            "fb_exchange_token": short_lived_or_current_token,
        },
    )


async def get_pages(user_token: str) -> list[dict]:
    """Returns the user's Facebook Pages, each with its own Page access token."""
    data = await _get("me/accounts", {"access_token": user_token})
    return data.get("data", [])


async def get_linked_instagram(page_id: str, page_token: str) -> dict | None:
    """Returns {id, username} for the Page's linked Instagram professional
    account, or None if it has none.
    """
    data = await _get(
        page_id,
        {"fields": "instagram_business_account{id,username}", "access_token": page_token},
    )
    return data.get("instagram_business_account")


async def publish_page_feed(page_id: str, page_token: str, message: str) -> dict:
    """Text-only Page post. Returns {id: '<page_id>_<post_id>'}."""
    return await _post_form(f"{page_id}/feed", {"message": message, "access_token": page_token})


async def publish_page_photo(page_id: str, page_token: str, caption: str, file_path: str) -> dict:
    """Direct-upload a local image file as a Page photo post. Returns {id, post_id}."""
    return await _post_multipart(
        f"{page_id}/photos",
        {"caption": caption, "access_token": page_token},
        file_path,
        "source",
    )


async def publish_page_video(page_id: str, page_token: str, description: str, file_path: str) -> dict:
    """Direct-upload a local video file as a Page video post. Returns {id}."""
    return await _post_multipart(
        f"{page_id}/videos",
        {"description": description, "access_token": page_token},
        file_path,
        "source",
    )


async def create_instagram_container(
    ig_user_id: str, ig_token: str, caption: str, media_url: str, is_video: bool
) -> str:
    """Starts Instagram's async media processing for a publicly-fetchable
    media_url. Returns a creation_id (container) to poll and then publish.
    """
    data = {"caption": caption, "access_token": ig_token}
    if is_video:
        data["video_url"] = media_url
        data["media_type"] = "REELS"
    else:
        data["image_url"] = media_url

    result = await _post_form(f"{ig_user_id}/media", data)
    return result["id"]


async def get_container_status(creation_id: str, ig_token: str) -> str:
    data = await _get(creation_id, {"fields": "status_code", "access_token": ig_token})
    return data.get("status_code", "UNKNOWN")


async def publish_instagram_container(ig_user_id: str, ig_token: str, creation_id: str) -> dict:
    return await _post_form(
        f"{ig_user_id}/media_publish", {"creation_id": creation_id, "access_token": ig_token}
    )


async def publish_to_instagram(
    ig_user_id: str, ig_token: str, caption: str, media_url: str, is_video: bool
) -> str:
    """Full create-container -> poll -> publish flow. Returns the published media id."""
    creation_id = await create_instagram_container(ig_user_id, ig_token, caption, media_url, is_video)

    for _ in range(INSTAGRAM_CONTAINER_MAX_POLLS):
        status_code = await get_container_status(creation_id, ig_token)
        if status_code == "FINISHED":
            break
        if status_code in ("ERROR", "EXPIRED"):
            raise FacebookAPIError(f"Instagram media processing failed ({status_code})")
        await asyncio.sleep(INSTAGRAM_CONTAINER_POLL_INTERVAL_SECONDS)
    else:
        raise FacebookAPIError("Timed out waiting for Instagram to finish processing the media")

    result = await publish_instagram_container(ig_user_id, ig_token, creation_id)
    return result.get("id", "")
