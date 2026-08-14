from pathlib import Path

from app.core.config import settings


def media_url_path(media_path: str) -> str:
    """Returns the public URL path (e.g. '/uploads/<user>/<file>.ext') for a
    stored media_path, regardless of whether UPLOADS_DIR is configured as a
    relative path (local dev) or an absolute one (e.g. a mounted volume in
    production). The StaticFiles mount at /uploads serves settings.uploads_dir,
    so this just strips that prefix off however it was stored.
    """
    try:
        rel = Path(media_path).relative_to(settings.uploads_dir).as_posix()
    except ValueError:
        rel = Path(media_path).name
    return f"/uploads/{rel}"
