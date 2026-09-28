"""Text layers for reels: the font registry and the one normalized shape
every layer is stored and rendered in.

A layer is {text, font, font_size, color, x, y, background}. (x, y) is the
centre of the text block as a fraction of the frame (0-1), set by dragging
it in the preview; font_size is in px on a 1080px-wide frame. Older layers
stored a `position` preset instead of x/y - those are converted here.
"""

import re
from pathlib import Path

FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

# id -> (display name, file). All SIL OFL, from Google Fonts - see
# assets/fonts/README.md.
FONTS: dict[str, tuple[str, str]] = {
    "poppins": ("Poppins", "Poppins-Bold.ttf"),
    "anton": ("Anton", "Anton-Regular.ttf"),
    "bebas": ("Bebas Neue", "BebasNeue-Regular.ttf"),
    "dmserif": ("DM Serif Display", "DMSerifDisplay-Regular.ttf"),
    "lobster": ("Lobster", "Lobster-Regular.ttf"),
    "pacifico": ("Pacifico", "Pacifico-Regular.ttf"),
    "hind": ("Hind (हिन्दी + English)", "Hind-Bold.ttf"),
}
DEFAULT_FONT = "poppins"

MIN_FONT_SIZE = 16
MAX_FONT_SIZE = 160
DEFAULT_FONT_SIZE = 56
DEFAULT_TEXT_COLOR = "#FFFFFF"
MAX_TEXT_LAYERS = 30
MAX_TEXT_CHARS = 300

# Legacy `position` presets -> (x, y) block centres.
_LEGACY_POSITIONS: dict[str, tuple[float, float]] = {
    f"{v}_{h}": (x, y)
    for v, y in (("top", 0.08), ("middle", 0.5), ("bottom", 0.88))
    for h, x in (("left", 0.3), ("center", 0.5), ("right", 0.7))
}
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def font_path(font_id: str | None) -> str:
    return str(FONTS_DIR / FONTS.get(font_id or "", FONTS[DEFAULT_FONT])[1])


def public_fonts() -> list[dict]:
    return [{"id": font_id, "name": name, "url": f"/reel-fonts/{file}"} for font_id, (name, file) in FONTS.items()]


def _clamp(value: object, low: float, high: float, default: float) -> float:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def normalize_text_layer(raw: object) -> dict | None:
    """The layer in canonical form, or None if it has no text. Invalid
    values fall back to defaults rather than failing."""
    if not isinstance(raw, dict):
        return None
    text = str(raw.get("text") or "").strip()[:MAX_TEXT_CHARS]
    if not text:
        return None

    legacy_x, legacy_y = _LEGACY_POSITIONS.get(str(raw.get("position") or ""), (0.5, 0.88))
    color = str(raw.get("color") or DEFAULT_TEXT_COLOR)
    font = str(raw.get("font") or DEFAULT_FONT)
    return {
        "text": text,
        "font": font if font in FONTS else DEFAULT_FONT,
        "font_size": round(_clamp(raw.get("font_size"), MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULT_FONT_SIZE)),
        "color": color if _HEX.match(color) else DEFAULT_TEXT_COLOR,
        "x": _clamp(raw.get("x"), 0.0, 1.0, legacy_x),
        "y": _clamp(raw.get("y"), 0.0, 1.0, legacy_y),
        "background": bool(raw.get("background", True)),
    }


def normalize_text_layers(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        return []
    return [layer for layer in (normalize_text_layer(item) for item in raw[:MAX_TEXT_LAYERS]) if layer]


# --- Calls to action -------------------------------------------------------
# A CTA is a button-style badge that pops onto the reel at a chosen moment:
# {text, link, clip, offset, duration, x, y, font, font_size, text_color,
#  bg_color, animation}. `clip` is an index into the post's source clips,
# `offset` the seconds into that clip it appears at and `duration` how long
# it stays - it can run on past the clip's end, over later clips. `link`
# can't be clickable inside a video, so it's added to the post text instead.

CTA_ANIMATIONS = ("pop", "slide_up", "fade", "pulse")
MAX_CTAS = 10
MIN_CTA_SECONDS = 0.5
MAX_CTA_SECONDS = 90.0
_URL = re.compile(r"^https?://[^\s/$.?#][^\s]*$", re.IGNORECASE)


def clean_link(raw: object) -> str | None:
    """A usable http(s) URL (https:// added when missing), or None."""
    link = str(raw or "").strip()
    if not link:
        return None
    if not re.match(r"^https?://", link, re.IGNORECASE):
        link = f"https://{link}"
    return link[:500] if _URL.match(link) else None


def normalize_cta(raw: object, clip_count: int) -> dict | None:
    if not isinstance(raw, dict):
        return None
    text = str(raw.get("text") or "").strip()[:80]
    if not text:
        return None
    text_color = str(raw.get("text_color") or "#FFFFFF")
    bg_color = str(raw.get("bg_color") or "#F97316")
    font = str(raw.get("font") or DEFAULT_FONT)
    animation = str(raw.get("animation") or "pop")
    return {
        "text": text,
        "link": clean_link(raw.get("link")),
        "clip": int(_clamp(raw.get("clip"), 0, max(0, clip_count - 1), 0)),
        "offset": round(_clamp(raw.get("offset"), 0.0, MAX_CTA_SECONDS, 1.0), 2),
        "duration": round(_clamp(raw.get("duration"), MIN_CTA_SECONDS, MAX_CTA_SECONDS, 4.0), 2),
        "x": _clamp(raw.get("x"), 0.0, 1.0, 0.5),
        "y": _clamp(raw.get("y"), 0.0, 1.0, 0.8),
        "font": font if font in FONTS else DEFAULT_FONT,
        "font_size": round(_clamp(raw.get("font_size"), MIN_FONT_SIZE, MAX_FONT_SIZE, 56)),
        "text_color": text_color if _HEX.match(text_color) else "#FFFFFF",
        "bg_color": bg_color if _HEX.match(bg_color) else "#F97316",
        "animation": animation if animation in CTA_ANIMATIONS else "pop",
    }


def normalize_ctas(raw: object, clip_count: int) -> list[dict]:
    if not isinstance(raw, list):
        return []
    return [cta for cta in (normalize_cta(item, clip_count) for item in raw[:MAX_CTAS]) if cta]
