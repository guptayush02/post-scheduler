from pathlib import Path
from urllib.parse import urlencode

import httpx

from app.core.config import settings


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
