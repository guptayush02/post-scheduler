from pathlib import Path

from app.core.config import settings


def _relative_to_uploads(media_path: str) -> str:
    """The '<user>/<file>.ext' part of a stored media path.

    Paths are stored with whatever UPLOADS_DIR the writing process had, and
    the same database can be shared by environments that disagree on it
    ('uploads' locally vs '/data/uploads' in the container). So match on the
    uploads directory *name* rather than the full configured prefix -
    falling back to just the filename silently drops the per-user folder and
    produces a URL that 404s.
    """
    parts = Path(media_path).as_posix().strip("/").split("/")
    uploads_name = Path(settings.uploads_dir).name
    if uploads_name in parts:
        last = len(parts) - 1 - parts[::-1].index(uploads_name)
        return "/".join(parts[last + 1 :])
    return parts[-1]


def media_url_path(media_path: str) -> str:
    """Public URL path (e.g. '/uploads/<user>/<file>.ext') for a stored
    media_path. The StaticFiles mount at /uploads serves
    settings.uploads_dir, so this strips that prefix however it was stored.
    """
    return f"/uploads/{_relative_to_uploads(media_path)}"


def resolve_media_path(media_path: str) -> Path:
    """The on-disk path for a stored media_path in *this* environment.

    Returns it as stored when that file exists; otherwise re-roots it under
    the current UPLOADS_DIR, so a row written by an environment with a
    different UPLOADS_DIR still resolves as long as the file is present.
    """
    stored = Path(media_path)
    if stored.is_file():
        return stored
    return Path(settings.uploads_dir) / _relative_to_uploads(media_path)
