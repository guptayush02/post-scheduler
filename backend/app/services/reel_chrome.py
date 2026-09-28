"""Pillow-drawn graphics for reels: transparent full-frame PNG overlays
(the user's text layers, their logo, and template chrome - letterbox,
frame, hook title), animated call-to-action badges (frame sequences), and
opaque intro/outro cards.

Drawn here rather than with ffmpeg's drawtext so the fonts, placement and
wrapping match the frontend's live preview (which mirrors the maths below),
and so it works on ffmpeg builds without drawtext. Sizes are authored
against a 1080x1920 frame and scaled by SCALE.

Only text the user typed in is ever drawn - never the post caption.
"""

import math
import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.core.media import resolve_media_path
from app.services.reel_generator import HEIGHT, SCALE, WIDTH, _UNRENDERABLE_TEXT, _resolve_font_path, _wrap_text
from app.services.reel_text import DEFAULT_FONT, font_path

MAX_TITLE_CHARS = 90
# Must match the live preview (frontend/src/components/ReelAnimationPreview.tsx).
TEXT_MAX_WIDTH = 0.9
TEXT_LINE_HEIGHT = 1.25
TEXT_PAD_X = 0.35  # x font size
TEXT_PAD_Y = 0.2
TEXT_BOX_ALPHA = 110  # ~0.43 opacity
DEFAULT_LOGO = {"x": 0.85, "y": 0.08, "scale": 0.16}


def _px(value: float) -> int:
    return max(1, round(value * SCALE))


def _ui_font(size: int, font_id: str | None = None):
    if font_id:
        return ImageFont.truetype(font_path(font_id), size)
    path = font_path(DEFAULT_FONT) or _resolve_font_path()
    return ImageFont.truetype(path, size) if path else ImageFont.load_default(size=size)


def clean_text(text: str, limit: int) -> str:
    text = re.sub(r"[ \t]+", " ", _UNRENDERABLE_TEXT.sub("", text or "")).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _hex_rgb(color: str | None) -> tuple[int, int, int]:
    h = (color or "").lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        h = "4F46E5"
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def _shade(rgb: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(c * factor))) for c in rgb)


def _wrap_lines(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        lines.extend(_wrap_text(draw, paragraph, font, max_width) or [""])
    return lines


def _draw_block(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    font,
    font_size: int,
    center: tuple[float, float],
    fill,
    background=None,
    stroke: int = 0,
    max_width: int | None = None,
    radius: int | None = None,
) -> tuple[int, int]:
    """Draws centred, wrapped text around `center` (kept inside the frame),
    optionally on a rounded box. Returns the block's (top, bottom)."""
    pad_x, pad_y = round(font_size * TEXT_PAD_X), round(font_size * TEXT_PAD_Y)
    max_width = max_width or round(WIDTH * TEXT_MAX_WIDTH) - 2 * pad_x
    lines = _wrap_lines(draw, text, font, max_width)
    line_height = round(font_size * TEXT_LINE_HEIGHT)
    block_w = max((draw.textlength(line, font=font) for line in lines), default=0)
    block_h = line_height * len(lines)

    left = min(max(center[0] - block_w / 2, pad_x), WIDTH - block_w - pad_x)
    top = min(max(center[1] - block_h / 2, pad_y), HEIGHT - block_h - pad_y)

    if background is not None:
        draw.rounded_rectangle(
            [left - pad_x, top - pad_y, left + block_w + pad_x, top + block_h + pad_y],
            radius=radius if radius is not None else round(font_size * 0.25),
            fill=background,
        )
    y = top
    for line in lines:
        x = left + (block_w - draw.textlength(line, font=font)) / 2
        # Line boxes are line_height tall with the glyphs centred, as in CSS.
        draw.text((x, y + (line_height - font_size) / 2), line, font=font, fill=fill,
                  stroke_width=stroke, stroke_fill=(0, 0, 0, 200))
        y += line_height
    return round(top), round(top + block_h)


def _draw_text_layer(draw: ImageDraw.ImageDraw, layer: dict) -> bool:
    text = clean_text(layer.get("text") or "", 300)
    if not text:
        return False
    font_size = max(8, round(layer["font_size"] * SCALE))
    _draw_block(
        draw,
        text,
        font=_ui_font(font_size, layer.get("font")),
        font_size=font_size,
        center=(layer["x"] * WIDTH, layer["y"] * HEIGHT),
        fill=(*_hex_rgb(layer.get("color")), 255),
        background=(0, 0, 0, TEXT_BOX_ALPHA) if layer.get("background", True) else None,
        stroke=max(1, round(font_size * 0.04)),
    )
    return True


def _draw_logo(image: Image.Image, brand: dict, *, center=None, width=None) -> bool:
    logo_path = brand.get("logo_path")
    if not logo_path:
        return False
    path = resolve_media_path(logo_path)
    if not path.is_file():
        return False
    logo = Image.open(path).convert("RGBA")
    box = round(width if width is not None else WIDTH * float(brand.get("logo_scale") or DEFAULT_LOGO["scale"]))
    logo.thumbnail((box, box))
    cx, cy = center or (
        float(brand.get("logo_x", DEFAULT_LOGO["x"])) * WIDTH,
        float(brand.get("logo_y", DEFAULT_LOGO["y"])) * HEIGHT,
    )
    left = int(min(max(cx - logo.width / 2, 0), WIDTH - logo.width))
    top = int(min(max(cy - logo.height / 2, 0), HEIGHT - logo.height))
    image.alpha_composite(logo, (left, top))
    return True


def _draw_chrome(draw: ImageDraw.ImageDraw, template: dict, brand: dict) -> bool:
    brand_rgb = _hex_rgb(brand.get("color"))
    drew = False

    if template.get("letterbox"):
        bar = round(HEIGHT * 0.11)
        draw.rectangle([0, 0, WIDTH, bar], fill=(0, 0, 0, 255))
        draw.rectangle([0, HEIGHT - bar, WIDTH, HEIGHT], fill=(0, 0, 0, 255))
        drew = True

    if template.get("frame"):
        border = _px(18)
        draw.rectangle([0, 0, WIDTH - 1, HEIGHT - 1], outline=(*brand_rgb, 255), width=border)
        drew = True
    return drew


def render_overlay(
    out_path: str,
    *,
    layers: list[dict] = (),
    template: dict | None = None,
    brand: dict | None = None,
    with_logo: bool = False,
) -> str | None:
    """One transparent overlay: template chrome, then the logo, then text
    layers on top. Returns None when there's nothing to draw."""
    brand = brand or {}
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    drew = False
    if template:
        drew |= _draw_chrome(draw, template, brand)
    if with_logo:
        drew |= _draw_logo(image, brand)
        draw = ImageDraw.Draw(image)
    for layer in layers:
        drew |= _draw_text_layer(draw, layer)
    if not drew:
        return None
    image.save(out_path)
    return out_path


def render_hook(title: str, style: str, brand: dict, out_path: str) -> str | None:
    title = clean_text(title, MAX_TITLE_CHARS)
    if not title:
        return None
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if style == "elegant":
        size = _px(76)
        _draw_block(draw, title, font=_ui_font(size, "dmserif"), font_size=size, center=(WIDTH / 2, HEIGHT / 2),
                    fill=(255, 255, 255, 255), stroke=_px(3))
    else:
        size = _px(92)
        _draw_block(draw, title.upper(), font=_ui_font(size, "anton"), font_size=size,
                    center=(WIDTH / 2, HEIGHT * 0.36), fill=(255, 255, 255, 255),
                    background=(*_hex_rgb(brand.get("color")), 235))
    image.save(out_path)
    return out_path


def render_card(title: str, subtitle: str, brand: dict, out_path: str) -> str:
    """Opaque full-frame intro/outro card on a brand-colour gradient, with
    the logo and whatever title/subtitle the user entered (may be none)."""
    top_rgb = _hex_rgb(brand.get("color"))
    bottom_rgb = _shade(top_rgb, 0.35)
    image = Image.new("RGBA", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        t = y / (HEIGHT - 1)
        draw.line([(0, y), (WIDTH, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top_rgb, bottom_rgb)))

    title = clean_text(title, MAX_TITLE_CHARS)
    _draw_logo(image, brand, center=(WIDTH / 2, HEIGHT * (0.3 if title else 0.45)), width=_px(300))
    draw = ImageDraw.Draw(image)
    if title:
        size = _px(88)
        _, title_bottom = _draw_block(draw, title, font=_ui_font(size), font_size=size,
                                      center=(WIDTH / 2, HEIGHT * 0.52), fill=(255, 255, 255, 255), stroke=_px(2))
        subtitle = clean_text(subtitle, 40)
        if subtitle:
            size = _px(50)
            _draw_block(draw, subtitle, font=_ui_font(size), font_size=size,
                        center=(WIDTH / 2, title_bottom + _px(140)), fill=(*top_rgb, 255),
                        background=(255, 255, 255, 245), radius=size)
    image.convert("RGB").save(out_path, "JPEG", quality=92)
    return out_path


# --- Animated call-to-action badges -----------------------------------------
# Must match the live preview's CSS keyframes (ReelAnimationPreview.tsx).
CTA_IN_SECONDS = 0.4
CTA_OUT_SECONDS = 0.25


def _ease_out_back(p: float) -> float:
    c1 = 1.70158
    return 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2


def _ease_out_cubic(p: float) -> float:
    return 1 - (1 - p) ** 3


def _cta_badge(cta: dict) -> Image.Image:
    """The CTA's pill-shaped button at its final size."""
    font_size = max(8, round(cta["font_size"] * SCALE))
    text = clean_text(cta["text"], 80)
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    while True:
        font = _ui_font(font_size, cta.get("font"))
        text_w = probe.textlength(text, font=font)
        pad_x = round(font_size * 0.8)
        if text_w + 2 * pad_x <= WIDTH * 0.92 or font_size <= 10:
            break
        font_size -= max(1, round(font_size * 0.08))
    pad_y = round(font_size * 0.45)
    line_h = round(font_size * TEXT_LINE_HEIGHT)
    width, height = round(text_w) + 2 * pad_x, line_h + 2 * pad_y
    badge = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(badge)
    draw.rounded_rectangle([0, 0, width - 1, height - 1], radius=height // 2, fill=(*_hex_rgb(cta["bg_color"]), 255))
    draw.text((pad_x, pad_y + (line_h - font_size) / 2), text, font=font, fill=(*_hex_rgb(cta["text_color"]), 255))
    return badge


def render_cta_frames(cta: dict, out_dir: str, fps: int) -> tuple[str, int, int]:
    """Renders the CTA's whole on-screen life (animate in, hold, fade out)
    as a PNG sequence on a small canvas. Returns (ffmpeg input pattern, x,
    y) - where the canvas goes on the frame so the badge's resting centre
    sits at the CTA's (x, y). Identical frames are hard links, so a long
    hold costs almost nothing."""
    badge = _cta_badge(cta)
    bw, bh = badge.size
    margin = round(max(bw, bh) * 0.1) + 2  # room for the pop's overshoot
    slide = round(bh * 0.8)
    cw, ch = bw + 2 * margin, bh + 2 * margin + slide
    anchor_x, anchor_y = cw / 2, margin + bh / 2

    Path(out_dir).mkdir(parents=True, exist_ok=True)
    frames = max(1, round(cta["duration"] * fps))
    animation = cta.get("animation", "pop")
    previous: tuple | None = None
    previous_path = ""
    for k in range(frames):
        t = k / fps
        p = min(1.0, t / CTA_IN_SECONDS)
        scale, dy, alpha = 1.0, 0.0, 1.0
        if animation in ("pop", "pulse"):
            scale = 0.3 + 0.7 * _ease_out_back(p)
            alpha = min(1.0, t / 0.12)
            if animation == "pulse" and t > CTA_IN_SECONDS:
                scale *= 1 + 0.05 * math.sin(2 * math.pi * (t - CTA_IN_SECONDS) / 0.9)
        elif animation == "slide_up":
            dy = (1 - _ease_out_cubic(p)) * slide
            alpha = _ease_out_cubic(p)
        else:  # fade
            alpha = p
        remaining = cta["duration"] - t
        if remaining < CTA_OUT_SECONDS:
            alpha *= max(0.0, remaining / CTA_OUT_SECONDS)

        key = (round(scale, 3), round(dy), round(alpha, 2))
        path = str(Path(out_dir) / f"f_{k:05d}.png")
        if key == previous:
            os.link(previous_path, path)
            continue

        canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        frame = badge
        if key[0] != 1.0:
            frame = badge.resize((max(1, round(bw * scale)), max(1, round(bh * scale))), Image.LANCZOS)
        if key[2] < 1.0:
            a = frame.getchannel("A").point(lambda v: round(v * key[2]))
            frame = frame.copy()
            frame.putalpha(a)
        canvas.alpha_composite(frame, (round(anchor_x - frame.width / 2), round(anchor_y + dy - frame.height / 2)))
        canvas.save(path)
        previous, previous_path = key, path

    x = round(cta["x"] * WIDTH - anchor_x)
    y = round(cta["y"] * HEIGHT - anchor_y)
    # Keep the resting badge fully on screen.
    x = min(max(x, -margin), WIDTH - bw - margin)
    y = min(max(y, -margin), HEIGHT - bh - margin)
    return str(Path(out_dir) / "f_%05d.png"), x, y
