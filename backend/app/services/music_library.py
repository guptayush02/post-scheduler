"""Free music for reels, searched through Openverse (api.openverse.org) -
WordPress's open index of Creative Commons media, usable without an API key
(anonymous requests are rate-limited).

Only licenses that allow putting a song into a video - including for
commercial use - are offered: CC0, Public Domain Mark and CC BY. Excluded:
NoDerivatives (syncing music to video counts as an adaptation), ShareAlike
(the whole reel would have to be CC BY-SA) and NonCommercial. CC BY needs
credit, which the scheduler adds to the post text (see music_credit).
"""

import logging
import re
import time
import uuid
from pathlib import Path

import httpx

logger = logging.getLogger("scheduler.music")

API = "https://api.openverse.org/v1/audio/"
LICENSES = "by,cc0,pdm"
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
_CACHE_SECONDS = 600
_cache: dict[str, tuple[float, dict]] = {}
_ID = re.compile(r"^[0-9a-f-]{36}$")

LICENSE_NAMES = {"by": "CC BY", "cc0": "CC0", "pdm": "Public Domain"}


class MusicError(Exception):
    pass


def _track(raw: dict) -> dict:
    duration_ms = raw.get("duration") or 0
    return {
        "id": raw["id"],
        "title": raw.get("title") or "Untitled",
        "creator": raw.get("creator") or "Unknown artist",
        "duration": round(duration_ms / 1000, 1) if duration_ms else None,
        "license": raw.get("license"),
        "license_version": raw.get("license_version"),
        "license_url": raw.get("license_url"),
        "landing_url": raw.get("foreign_landing_url"),
        "genres": raw.get("genres") or [],
        "preview_url": raw.get("url"),
        "source": raw.get("source"),
    }


async def _get(url: str, params: dict | None = None) -> dict:
    key = url + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "post-scheduler/1.0"}) as client:
            response = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise MusicError(f"Couldn't reach the music library: {exc}") from exc
    if response.status_code == 429:
        raise MusicError("The music library is busy (rate limit) - try again in a minute")
    if response.status_code == 404:
        raise MusicError("That track isn't available any more")
    if response.status_code >= 400:
        raise MusicError(f"Music library error ({response.status_code})")
    data = response.json()
    _cache[key] = (time.monotonic(), data)
    if len(_cache) > 500:
        _cache.pop(next(iter(_cache)))
    return data


async def search(query: str, page: int = 1) -> dict:
    data = await _get(API, {
        "q": query.strip()[:100],
        "license": LICENSES,
        "category": "music",
        "page_size": 20,
        "page": max(1, min(page, 12)),
    })
    return {
        "results": [_track(r) for r in data.get("results", []) if r.get("url")],
        "page": data.get("page", page),
        "page_count": data.get("page_count", 1),
    }


async def get_track(track_id: str) -> dict:
    if not _ID.match(track_id or ""):
        raise MusicError("Invalid track id")
    raw = await _get(f"{API}{track_id}/")
    if raw.get("license") not in LICENSE_NAMES or not raw.get("url"):
        raise MusicError("That track's license doesn't allow using it in a video")
    return _track(raw)


async def download(track: dict, dest_dir: Path) -> str:
    """Saves the track (by the URL Openverse reported for it - never one
    from the client) and returns the local path."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{uuid.uuid4().hex}.mp3"
    size = 0
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            async with client.stream("GET", track["preview_url"]) as response:
                if response.status_code >= 400:
                    raise MusicError(f"Couldn't download the track ({response.status_code})")
                with dest.open("wb") as out:
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > MAX_DOWNLOAD_BYTES:
                            raise MusicError("That track is too large to use")
                        out.write(chunk)
    except MusicError:
        dest.unlink(missing_ok=True)
        raise
    except httpx.HTTPError as exc:
        dest.unlink(missing_ok=True)
        raise MusicError(f"Couldn't download the track: {exc}") from exc
    return str(dest.as_posix())


def music_credit(track: dict) -> str | None:
    """The attribution line CC BY requires (title, creator, license + link),
    or None for CC0 / public domain."""
    if track.get("license") != "by":
        return None
    version = f" {track['license_version']}" if track.get("license_version") else ""
    link = f" {track['license_url']}" if track.get("license_url") else ""
    return f'Music: "{track["title"]}" by {track["creator"]} - CC BY{version}{link}'
