"""Assembles a 30-60s vertical "reel" video from a caption + an ordered list
of source segments, using FFmpeg. A segment is either a still image (Ken
Burns zoom/pan) or a video clip (an upload, or AI footage from
hf_media - fitted onto a blurred copy of itself, looped/trimmed to its slot),
joined with crossfade transitions and the caption burned in as text.
"""

import asyncio
import logging
import os
import re
import subprocess
import tempfile
import uuid
from functools import lru_cache
from pathlib import Path

from app.core.media import resolve_media_path

logger = logging.getLogger("scheduler.reel_generator")

WIDTH = 1080
HEIGHT = 1920
FPS = 30
XFADE_SECONDS = 1.0
TARGET_TOTAL_SECONDS = 45.0
FFMPEG_TIMEOUT_SECONDS = 300
MAX_CAPTION_OVERLAY_CHARS = 200
# Per-image on-screen duration bounds (before crossfade overlap is
# subtracted). Must stay above XFADE_SECONDS so a clip never gets
# entirely eaten by its own crossfade.
MIN_IMAGE_SECONDS = 2.0
MAX_IMAGE_SECONDS = 60.0

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}

# Debian (Docker image, via the `fonts-dejavu-core` apt package) first, then
# common local dev fallbacks (macOS). If none exist, the caption text overlay
# is skipped for that run rather than failing the whole generation.
_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]

# Every crossfade transition ffmpeg's xfade filter supports (`ffmpeg -h
# filter=xfade`), so the two axes - which xfade transition plays between
# images, and whether/how each image itself zooms (Ken Burns) - are
# independent controls rather than a handful of bundled presets.
XFADE_TRANSITIONS: list[str] = [
    "fade", "fadeblack", "fadewhite", "fadegrays", "fadefast", "fadeslow", "distance", "radial",
    "wipeleft", "wiperight", "wipeup", "wipedown", "wipetl", "wipetr", "wipebl", "wipebr",
    "slideleft", "slideright", "slideup", "slidedown",
    "smoothleft", "smoothright", "smoothup", "smoothdown",
    "circlecrop", "rectcrop", "circleopen", "circleclose",
    "vertopen", "vertclose", "horzopen", "horzclose",
    "dissolve", "pixelize",
    "diagtl", "diagtr", "diagbl", "diagbr",
    "hlslice", "hrslice", "vuslice", "vdslice",
    "hblur", "hlwind", "hrwind", "vuwind", "vdwind",
    "squeezeh", "squeezev", "zoomin",
    "coverleft", "coverright", "coverup", "coverdown",
    "revealleft", "revealright", "revealup", "revealdown",
]
DEFAULT_TRANSITION = "fade"

ZOOM_STYLES: dict[str, str] = {
    "zoom_in": "min(1.0+on*0.0015,1.2)",
    "zoom_out": "max(1.2-on*0.0015,1.0)",
    "none": "1.0",
}
DEFAULT_ZOOM_STYLE = "zoom_in"

# Colour grading presets applied per image, right after the crop and before
# the Ken Burns zoom. "none" means no extra filter at all.
COLOR_FILTERS: dict[str, str] = {
    "none": "",
    # colorbalance is split into shadows/midtones/highlights (s/m/h) - all
    # three have to move or the tint is invisible on bright, flat images.
    "warm": "colorbalance=rs=0.1:rm=0.2:rh=0.15:bs=-0.1:bm=-0.2:bh=-0.15",
    "cool": "colorbalance=rs=-0.1:rm=-0.2:rh=-0.15:bs=0.1:bm=0.2:bh=0.15",
    "vivid": "eq=saturation=1.5:contrast=1.12",
    "muted": "eq=saturation=0.6:contrast=0.95:brightness=0.03",
    "vintage": "curves=vintage",
    "bw": "hue=s=0",
}
DEFAULT_COLOR_FILTER = "none"

# Text layers: a 3x3 grid of drawtext (x, y) expressions.
TEXT_POSITIONS: dict[str, tuple[str, str]] = {
    "top_left": ("40", "60"),
    "top_center": ("(w-text_w)/2", "60"),
    "top_right": ("w-text_w-40", "60"),
    "middle_left": ("40", "(h-text_h)/2"),
    "middle_center": ("(w-text_w)/2", "(h-text_h)/2"),
    "middle_right": ("w-text_w-40", "(h-text_h)/2"),
    "bottom_left": ("40", "h-text_h-120"),
    "bottom_center": ("(w-text_w)/2", "h-text_h-120"),
    "bottom_right": ("w-text_w-40", "h-text_h-120"),
}
DEFAULT_TEXT_POSITION = "bottom_center"
MIN_FONT_SIZE = 16
MAX_FONT_SIZE = 120
DEFAULT_FONT_SIZE = 48
DEFAULT_TEXT_COLOR = "#FFFFFF"
MAX_TEXT_LAYERS = 5


class ReelGenerationError(Exception):
    pass


def is_video_path(path: str) -> bool:
    return Path(path).suffix.lower() in VIDEO_EXTENSIONS


async def probe_duration(path: str) -> float | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        return float(stdout.decode().strip())
    except Exception:
        return None


async def _default_clip_lens(paths: list[str], target_seconds: float) -> list[float]:
    """Per-segment on-screen seconds when the user hasn't set any. Video
    clips keep their natural length and the stills share whatever is left
    of the target; with no stills, the clips split the target evenly
    (looping or trimming to fit)."""
    n = len(paths)
    needed = target_seconds + (n - 1) * XFADE_SECONDS
    video_idx = [i for i, p in enumerate(paths) if is_video_path(p)]
    image_count = n - len(video_idx)

    if not video_idx or image_count == 0:
        return [max(MIN_IMAGE_SECONDS, min(needed / n, MAX_IMAGE_SECONDS))] * n

    lens = [0.0] * n
    for i in video_idx:
        natural = await probe_duration(paths[i]) or 5.0
        lens[i] = max(MIN_IMAGE_SECONDS, min(natural, MAX_IMAGE_SECONDS))
    per_image = (needed - sum(lens)) / image_count
    for i in range(n):
        if i not in video_idx:
            lens[i] = max(MIN_IMAGE_SECONDS, min(per_image, MAX_IMAGE_SECONDS))
    return lens


# Background gradients for title cards (top colour, bottom colour).
_TITLE_CARD_GRADIENTS = [
    ((67, 56, 202), (219, 39, 119)),
    ((15, 118, 110), (37, 99, 235)),
    ((234, 88, 12), (190, 18, 60)),
    ((30, 41, 59), (79, 70, 229)),
    ((101, 163, 13), (13, 148, 136)),
]


def _split_caption_for_cards(caption: str, max_cards: int) -> list[str]:
    text = re.sub(r"\s+", " ", _UNRENDERABLE_TEXT.sub("", caption)).strip()
    if not text:
        return [""] * 3
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    if len(sentences) < 3:
        words = text.split()
        if len(words) >= 9:
            size = -(-len(words) // 3)
            sentences = [" ".join(words[i : i + size]) for i in range(0, len(words), size)]
    if len(sentences) > max_cards:
        size = -(-len(sentences) // max_cards)
        sentences = [" ".join(sentences[i : i + size]) for i in range(0, len(sentences), size)]
    while len(sentences) < 3:
        sentences.append(sentences[len(sentences) % len(sentences)])
    return sentences


def _wrap_text(draw, text: str, font, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def render_title_cards(caption: str, out_dir: str, max_cards: int = 5) -> list[str]:
    """Plain gradient cards carrying the caption, split across several
    cards - the no-AI fallback for a text-only reel. Drawn with Pillow
    rather than ffmpeg's drawtext, which many ffmpeg builds lack."""
    from PIL import Image, ImageDraw, ImageFont

    font_path = _resolve_font_path()
    chunks = _split_caption_for_cards(caption, max_cards)
    paths: list[str] = []

    for idx, chunk in enumerate(chunks):
        top, bottom = _TITLE_CARD_GRADIENTS[idx % len(_TITLE_CARD_GRADIENTS)]
        image = Image.new("RGB", (WIDTH, HEIGHT))
        draw = ImageDraw.Draw(image)
        for y in range(HEIGHT):
            t = y / (HEIGHT - 1)
            color = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
            draw.line([(0, y), (WIDTH, y)], fill=color)

        font_size = 84
        while True:
            font = (
                ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default(size=font_size)
            )
            lines = _wrap_text(draw, chunk, font, WIDTH - 160)
            line_height = round(font_size * 1.3)
            if len(lines) * line_height <= HEIGHT * 0.6 or font_size <= 40:
                break
            font_size -= 8

        y = (HEIGHT - len(lines) * line_height) / 2
        for line in lines:
            x = (WIDTH - draw.textlength(line, font=font)) / 2
            draw.text((x, y), line, font=font, fill="white", stroke_width=3, stroke_fill=(0, 0, 0))
            y += line_height

        path = str((Path(out_dir) / f"{uuid.uuid4().hex}.jpg").as_posix())
        image.save(path, "JPEG", quality=92)
        paths.append(path)

    return paths


def _resolve_font_path() -> str | None:
    for candidate in _FONT_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    return None


@lru_cache(maxsize=1)
def _drawtext_filter_available() -> bool:
    # Not every ffmpeg build includes libfreetype (e.g. plain `brew install
    # ffmpeg` on macOS doesn't), which drawtext needs - check once so we can
    # skip the caption overlay instead of failing the whole generation.
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, timeout=10
        )
        return "drawtext" in result.stdout
    except Exception:
        return False


        # Emoji and other pictographs have no glyph in DejaVu (the font the
# container ships), and drawtext can fail outright rather than just
# rendering a blank box - so they're stripped from burned-in text. The
# full caption, emoji included, is still what gets posted.
_UNRENDERABLE_TEXT = re.compile(
    "["
    "\U00010000-\U0010FFFF"  # astral plane: emoji, symbols, pictographs
    "←-⇿"  # arrows
    "⌀-➿"  # misc technical, dingbats
    "⬀-⯿"  # misc symbols and arrows
    "︀-️"  # variation selectors
    "‍"  # zero-width joiner (emoji sequences)
    "]+"
)


def _prepare_caption_overlay_text(caption: str) -> str:
    stripped = _UNRENDERABLE_TEXT.sub("", caption)
    collapsed = re.sub(r"\s+", " ", stripped).strip()
    return collapsed[:MAX_CAPTION_OVERLAY_CHARS]


def _summarize_ffmpeg_error(stderr: str) -> str:
    """Pulls the lines that actually say what went wrong out of ffmpeg's
    output. A plain tail slice mostly returns the version banner and build
    flags, which says nothing about the failure.
    """
    noise = ("configuration:", "built with", "lib", "  Metadata:", "ffmpeg version")
    markers = (
        "error", "invalid", "no such", "unable to", "failed", "not found",
        "cannot", "unrecognized", "does not", "matches no streams",
    )
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    interesting = [
        line
        for line in lines
        if any(m in line.lower() for m in markers) and not line.startswith(noise)
    ]
    chosen = interesting[-6:] if interesting else lines[-6:]
    return " | ".join(chosen)[-1200:]


def _ffmpeg_color(hex_color: str) -> str:
    h = (hex_color or "").lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{6}", h):
        return f"0x{h}"
    return "0xFFFFFF"


def _compute_image_time_ranges(clip_lens: list[float]) -> list[tuple[float, float]]:
    """[start, end) on the final output timeline each image is the active/
    front-most one - the same offset math as the xfade chain, so a
    per-image text layer's `enable=between(t,start,end)` lines up with when
    that image is actually on screen (with a little natural overlap during
    the crossfade into/out of neighbors)."""
    ranges: list[tuple[float, float]] = [(0.0, clip_lens[0])]
    running_length = clip_lens[0]
    for i in range(1, len(clip_lens)):
        start = running_length - XFADE_SECONDS
        running_length += clip_lens[i] - XFADE_SECONDS
        ranges.append((start, running_length))
    return ranges


def _quote_filtergraph_value(value: str) -> str:
    # Wrap in single quotes so ':' and spaces (e.g. a macOS font path like
    # "Arial Bold.ttf") in fontfile/textfile values can't be misread as
    # filtergraph syntax. Inside single quotes only an embedded "'" needs
    # escaping, via the standard close-escape-reopen trick.
    return "'" + value.replace("'", "'\\''") + "'"


def _build_filter_complex(
    image_count: int,
    clip_lens: list[float],
    font_path: str | None,
    text_layers: list[dict],
    image_text_layers: list[list[dict]],
    transitions: list[str],
    zoom_styles: list[str],
    color_filters: list[str],
    is_video: list[bool],
) -> tuple[str, str, list[str], list[str]]:
    """`clip_lens[i]` is image i's own on-screen duration (before overlap),
    `zoom_styles[i]` its Ken Burns style, and `transitions[i]` the xfade
    transition used going from image i into image i+1 (its last entry, if
    any, is unused - there's nothing after the last image).

    `text_layers` are shown for the whole video; `image_text_layers[i]`
    (one list per image) only while image i is on screen. Each layer dict:
    {text, font_size, color, position}. Returns the filter string, the
    final output label, the temp text files written for drawtext (the
    caller must clean these up), and any warnings worth surfacing to the
    user (e.g. text that couldn't be rendered).
    """
    filters: list[str] = []
    labels: list[str] = []
    tmp_files: list[str] = []
    warnings: list[str] = []

    for i in range(image_count):
        color_expr = COLOR_FILTERS.get(color_filters[i], "")
        label = f"v{i}"
        if is_video[i]:
            # Clips come in any aspect ratio (AI models mostly render
            # landscape) - fit the whole frame onto a blurred, cropped copy
            # of itself instead of cropping most of it away. No zoompan:
            # the clip already moves.
            filters.append(
                f"[{i}:v]fps={FPS},setpts=PTS-STARTPTS,split=2[vs{i}a][vs{i}b];"
                f"[vs{i}a]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={WIDTH}:{HEIGHT},boxblur=20:2[vbg{i}];"
                f"[vs{i}b]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease[vfg{i}];"
                f"[vbg{i}][vfg{i}]overlay=(W-w)/2:(H-h)/2,setsar=1,"
                + (f"{color_expr}," if color_expr else "")
                + f"format=yuv420p[{label}]"
            )
        else:
            zoom_expr = ZOOM_STYLES.get(zoom_styles[i], ZOOM_STYLES[DEFAULT_ZOOM_STYLE])
            frames = max(1, round(clip_lens[i] * FPS))
            filters.append(
                f"[{i}:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={WIDTH}:{HEIGHT},setsar=1,"
                + (f"{color_expr}," if color_expr else "")
                + f"zoompan=z='{zoom_expr}':d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},format=yuv420p[{label}]"
            )
        labels.append(label)

    prev_label = labels[0]
    running_length = clip_lens[0]
    for i in range(1, image_count):
        xfade = transitions[i - 1] if transitions[i - 1] in XFADE_TRANSITIONS else DEFAULT_TRANSITION
        offset = running_length - XFADE_SECONDS
        out_label = f"xf{i}"
        filters.append(
            f"[{prev_label}][{labels[i]}]xfade=transition={xfade}:duration={XFADE_SECONDS}:offset={offset:.3f}[{out_label}]"
        )
        prev_label = out_label
        running_length += clip_lens[i] - XFADE_SECONDS

    all_layers: list[tuple[dict, tuple[float, float] | None]] = [(layer, None) for layer in text_layers]
    if any(image_text_layers):
        time_ranges = _compute_image_time_ranges(clip_lens)
        for i, layers in enumerate(image_text_layers):
            for layer in layers:
                all_layers.append((layer, time_ranges[i]))

    if all_layers and not font_path:
        warnings.append(
            "Text wasn't added to the video: this server's ffmpeg has no drawtext "
            "filter (built without libfreetype) or no usable font was found."
        )
        logger.warning(warnings[-1])
    elif font_path:
        for idx, (layer, time_range) in enumerate(all_layers):
            text = (layer.get("text") or "").strip()
            if not text:
                continue
            fd, tmp_path = tempfile.mkstemp(suffix=".txt", prefix=f"reel_text_{idx}_")
            with os.fdopen(fd, "w") as f:
                f.write(_prepare_caption_overlay_text(text))
            tmp_files.append(tmp_path)

            font_size = max(MIN_FONT_SIZE, min(int(layer.get("font_size") or DEFAULT_FONT_SIZE), MAX_FONT_SIZE))
            color = _ffmpeg_color(layer.get("color") or DEFAULT_TEXT_COLOR)
            x_expr, y_expr = TEXT_POSITIONS.get(
                layer.get("position") or DEFAULT_TEXT_POSITION, TEXT_POSITIONS[DEFAULT_TEXT_POSITION]
            )
            enable_clause = ""
            if time_range is not None:
                start, end = time_range
                enable_clause = f":enable='between(t\\,{start:.3f}\\,{end:.3f})'"

            out_label = f"txt{idx}"
            filters.append(
                f"[{prev_label}]drawtext=fontfile={_quote_filtergraph_value(font_path)}:"
                f"textfile={_quote_filtergraph_value(tmp_path)}:"
                f"fontsize={font_size}:fontcolor={color}:borderw=3:bordercolor=black@0.8:"
                f"x={x_expr}:y={y_expr}:box=1:boxcolor=black@0.4:boxborderw=20{enable_clause}"
                f"[{out_label}]"
            )
            prev_label = out_label

    return ";".join(filters), f"[{prev_label}]", tmp_files, warnings


async def generate_reel_video(
    image_paths: list[str],
    caption: str,
    out_path: str,
    *,
    image_durations: list[float] | None = None,
    target_seconds: float = TARGET_TOTAL_SECONDS,
    audio_path: str | None = None,
    audio_start: float = 0.0,
    audio_end: float | None = None,
    voice_audio_path: str | None = None,
    voice_audio_start: float = 0.0,
    voice_audio_end: float | None = None,
    transitions: list[str] | None = None,
    zoom_styles: list[str] | None = None,
    text_layers: list[dict] | None = None,
    image_text_layers: list[list[dict]] | None = None,
    color_filters: list[str] | None = None,
) -> list[str]:
    """Renders `out_path` (mp4) from the given ordered source paths + caption.
    Each source is a still image or a video clip (by file extension); the
    "image" naming below predates video segments and covers both.

    `text_layers` are burned in for the whole video and
    `image_text_layers[i]` only while image i is on screen; each layer is
    {text, font_size, color, position}. Passing `text_layers=None` (never
    customized) falls back to burning in `caption` as a single default
    layer, the way it always worked; passing an empty list means the user
    explicitly wants no text.

    `audio_path` ("music") and `voice_audio_path` ("voiceover") are two
    independent optional tracks, each with its own [start, end) trim. With
    both given, the music is auto-ducked under the voice track (via a
    sidechain compressor keyed off the voice's level) and the two are mixed;
    with only one given, that track alone is used as-is; with neither, the
    video is silent.

    `image_durations[i]` is image i's own on-screen duration in seconds
    (before crossfade overlap is subtracted) - when omitted (or the wrong
    length), `target_seconds` is split evenly across all images instead, as
    before. The video's total length is whatever that list sums to (minus
    overlaps), not a fixed target.

    `zoom_styles[i]` (one per image) and `transitions[i]` (one per image,
    the crossfade used going into the next one - the last entry is unused)
    default to DEFAULT_ZOOM_STYLE/DEFAULT_TRANSITION for every image when
    not given, or for any entry missing from a too-short list.

    With no `audio_path`, the video is silent (a muted track is still added -
    some platforms mishandle video with zero audio streams). With one, that
    file is trimmed to [audio_start, audio_end] (`audio_end=None` reads to
    the file's natural end), padded with silence if shorter than the video,
    hard-capped to the video's length, and given a 1s fade-out - it plays
    once, not looped, if it doesn't fill the video.

    Returns any warnings worth showing the user (the render still
    succeeded). Raises ReelGenerationError on any ffmpeg failure or timeout.
    """
    if not image_paths:
        raise ReelGenerationError("A reel needs at least one image or video")

    n = len(image_paths)

    # Stored paths may carry another environment's UPLOADS_DIR prefix (the
    # same database gets shared between local dev and the container), so
    # re-root them here. Fail with something readable instead of an opaque
    # ffmpeg exit code if an input is genuinely missing.
    image_paths = [str(resolve_media_path(p)) for p in image_paths]
    audio_path = str(resolve_media_path(audio_path)) if audio_path else None
    voice_audio_path = str(resolve_media_path(voice_audio_path)) if voice_audio_path else None

    for label, path in (
        [("video" if is_video_path(p) else "image", p) for p in image_paths]
        + ([("music", audio_path)] if audio_path else [])
        + ([("voiceover", voice_audio_path)] if voice_audio_path else [])
    ):
        if not Path(path).is_file():
            raise ReelGenerationError(f"Missing {label} file: {path}")

    if image_durations and len(image_durations) == n:
        clip_lens = [max(MIN_IMAGE_SECONDS, min(d, MAX_IMAGE_SECONDS)) for d in image_durations]
    else:
        clip_lens = await _default_clip_lens(image_paths, target_seconds)
    is_video = [is_video_path(p) for p in image_paths]

    total_seconds = sum(clip_lens) - (n - 1) * XFADE_SECONDS

    zoom_styles = (zoom_styles or [])[:n] + [DEFAULT_ZOOM_STYLE] * max(0, n - len(zoom_styles or []))
    transitions = (transitions or [])[:n] + [DEFAULT_TRANSITION] * max(0, n - len(transitions or []))
    color_filters = (color_filters or [])[:n] + [DEFAULT_COLOR_FILTER] * max(0, n - len(color_filters or []))

    font_path = _resolve_font_path() if _drawtext_filter_available() else None

    if text_layers is None:
        text_layers = [
            {
                "text": caption,
                "font_size": DEFAULT_FONT_SIZE,
                "color": DEFAULT_TEXT_COLOR,
                "position": DEFAULT_TEXT_POSITION,
            }
        ]
    resolved_image_text_layers = image_text_layers or []
    resolved_image_text_layers = (resolved_image_text_layers[:n] + [[]] * max(0, n - len(resolved_image_text_layers)))

    video_filters, video_out_label, tmp_text_files, warnings = _build_filter_complex(
        n,
        clip_lens,
        font_path,
        text_layers,
        resolved_image_text_layers,
        transitions,
        zoom_styles,
        color_filters,
        is_video,
    )

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)

    cmd: list[str] = ["ffmpeg", "-y"]
    for image_path, clip_len, video in zip(image_paths, clip_lens, is_video):
        # A clip shorter than its slot loops; a longer one is cut off.
        loop_args = ["-stream_loop", "-1"] if video else ["-loop", "1"]
        cmd += [*loop_args, "-t", f"{clip_len:.3f}", "-i", image_path]

    next_index = n
    music_index: int | None = None
    voice_index: int | None = None

    if audio_path:
        cmd += ["-ss", f"{audio_start:.3f}"]
        if audio_end is not None:
            cmd += ["-t", f"{max(0.0, audio_end - audio_start):.3f}"]
        cmd += ["-i", audio_path]
        music_index = next_index
        next_index += 1

    if voice_audio_path:
        cmd += ["-ss", f"{voice_audio_start:.3f}"]
        if voice_audio_end is not None:
            cmd += ["-t", f"{max(0.0, voice_audio_end - voice_audio_start):.3f}"]
        cmd += ["-i", voice_audio_path]
        voice_index = next_index
        next_index += 1

    fade_out = max(0.0, total_seconds - 1)
    audio_parts: list[str] = []

    if music_index is not None and voice_index is not None:
        # Normalize both tracks to the video's length first, duck the music
        # under the voice (sidechain compressor keyed off the voice level),
        # then mix - amix halves the combined level, so a compensating
        # volume boost brings it back to normal.
        # Labels prefixed "au" - the video chain above already owns
        # v0..vN/xf1..xfN/vout, and filtergraph labels are global, so these
        # must not collide with those.
        audio_parts.append(f"[{music_index}:a]apad[aumusraw];[aumusraw]atrim=0:{total_seconds:.3f}[aumus]")
        audio_parts.append(
            f"[{voice_index}:a]apad[auvocraw];[auvocraw]atrim=0:{total_seconds:.3f}[auvoctrim];"
            "[auvoctrim]asplit=2[auvocsc][auvocmix]"
        )
        audio_parts.append("[aumus][auvocsc]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[aumusducked]")
        audio_parts.append("[aumusducked][auvocmix]amix=inputs=2:duration=first:dropout_transition=0,volume=2[aumixed]")
        audio_parts.append(f"[aumixed]afade=t=out:st={fade_out:.3f}:d=1[afinal]")
        audio_map = "[afinal]"
    elif music_index is not None or voice_index is not None:
        idx = music_index if music_index is not None else voice_index
        audio_parts.append(
            f"[{idx}:a]apad[auraw];[auraw]atrim=0:{total_seconds:.3f}[autrimmed];"
            f"[autrimmed]afade=t=out:st={fade_out:.3f}:d=1[afinal]"
        )
        audio_map = "[afinal]"
    else:
        cmd += ["-f", "lavfi", "-t", f"{total_seconds:.3f}", "-i", "anullsrc=r=44100:channel_layout=stereo"]
        audio_map = f"{next_index}:a"
        next_index += 1

    audio_filters = ";".join(audio_parts) if audio_parts else None
    filter_complex = video_filters + (";" + audio_filters if audio_filters else "")
    cmd += ["-filter_complex", filter_complex]
    cmd += ["-map", video_out_label, "-map", audio_map]
    cmd += [
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac",
        "-shortest",
        out_path,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=FFMPEG_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ReelGenerationError(f"ffmpeg timed out after {FFMPEG_TIMEOUT_SECONDS}s")

        if proc.returncode != 0:
            raise ReelGenerationError(
                f"ffmpeg exited with code {proc.returncode}: "
                f"{_summarize_ffmpeg_error(stderr.decode(errors='replace'))}"
            )
    finally:
        for tmp_file in tmp_text_files:
            Path(tmp_file).unlink(missing_ok=True)

    return warnings
