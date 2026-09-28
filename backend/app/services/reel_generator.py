"""Assembles a 30-60s vertical "reel" video from a caption + an ordered list
of source segments, using FFmpeg. A segment is either a still image (Ken
Burns zoom/pan) or a video clip (an upload, or AI footage from
hf_media - fitted onto a blurred copy of itself, looped/trimmed to its slot),
joined with crossfade transitions, with the user's own text layers, logo
and template graphics laid over them (never the post caption).
"""

import asyncio
from dataclasses import dataclass, field, replace
import logging
import re
import shutil
import tempfile
import uuid
from pathlib import Path

from app.core.config import settings
from app.core.media import resolve_media_path
from app.services.reel_text import normalize_ctas, normalize_text_layers

logger = logging.getLogger("scheduler.reel_generator")

WIDTH = settings.reel_width
HEIGHT = settings.reel_height
# Text sizes/offsets are authored against a 1920px-tall frame.
SCALE = HEIGHT / 1920
FPS = 30
XFADE_SECONDS = 1.0
TARGET_TOTAL_SECONDS = 45.0
FFMPEG_TIMEOUT_SECONDS = 300
# Per-image on-screen duration bounds (before crossfade overlap is
# subtracted). Clips are also kept at least two transitions long (see
# min_clip in generate_reel_video), so a crossfade never eats a whole clip.
MIN_IMAGE_SECONDS = 1.0
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

# Ken Burns motion per still: zoompan (z, x, y) expressions, "{d}" being the
# clip's frame count. Zooms stay centred; pans drift across a 1.15x crop.
_CENTER_X = "iw/2-(iw/zoom/2)"
_CENTER_Y = "ih/2-(ih/zoom/2)"
ZOOM_STYLES: dict[str, tuple[str, str, str]] = {
    "zoom_in": ("min(1.0+on*0.0015,1.2)", _CENTER_X, _CENTER_Y),
    "zoom_out": ("max(1.2-on*0.0015,1.0)", _CENTER_X, _CENTER_Y),
    "pan_left": ("1.15", "(iw-iw/zoom)*(1-on/{d})", _CENTER_Y),
    "pan_right": ("1.15", "(iw-iw/zoom)*on/{d}", _CENTER_Y),
    "none": ("1.0", "0", "0"),
}
DEFAULT_ZOOM_STYLE = "zoom_in"

# Colour grading presets applied per clip, per frame (after the Ken Burns
# motion). "none" means no extra filter at all.
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

# Effects: whole looks layered on top of the colour filter, per frame.
EFFECTS: dict[str, str] = {
    "none": "",
    # Old film: faded warm tones, moving grain, dark corners.
    "film": (
        "curves=vintage,colorchannelmixer=rr=1.04:gg=0.98:bb=0.9,"
        "eq=saturation=0.8:contrast=0.92:brightness=0.03,noise=alls=10:allf=t,vignette=PI/4.5"
    ),
    # 80s camcorder / VHS tape: soft half-resolution picture, red/blue
    # fringing, punchy colour, tape noise and scanlines. The PLAY / date
    # stamp is a separate overlay (see _add_overlays).
    "vhs_80s": (
        f"scale={WIDTH // 2}:{HEIGHT // 2},scale={WIDTH}:{HEIGHT}:flags=bilinear,rgbashift=rh=3:bh=-3:gv=1,"
        "eq=saturation=1.35:contrast=1.08:brightness=0.02,noise=alls=14:allf=t,"
        "drawgrid=w=iw:h=4:t=1:c=black@0.2,vignette=PI/5"
    ),
}
DEFAULT_EFFECT = "none"

# Appended to every segment's chain so all xfade inputs already match
# exactly. JPEGs decode as full-range and video as limited-range; left
# mismatched, ffmpeg 7.x auto-inserts a scale filter in front of xfade that
# drops the frame rate (to 1/0), and xfade then refuses to configure.
SEGMENT_TAIL = (
    "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,"
    "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709,"
    f"fps={FPS}"
)


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


async def _default_clip_lens(paths: list[str], target_seconds: float, fade: float = XFADE_SECONDS) -> list[float]:
    """Per-segment on-screen seconds when the user hasn't set any. Video
    clips keep their natural length and the stills share whatever is left
    of the target; with no stills, the clips split the target evenly
    (looping or trimming to fit)."""
    n = len(paths)
    needed = target_seconds + (n - 1) * fade
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


def render_title_cards(out_dir: str, count: int = 3) -> list[str]:
    """Plain gradient backgrounds - the no-AI fallback for a text-only reel.
    Deliberately text-free: the caption never goes on the video, only text
    the user adds on the preview page does."""
    from PIL import Image, ImageDraw

    paths: list[str] = []
    for idx in range(count):
        top, bottom = _TITLE_CARD_GRADIENTS[idx % len(_TITLE_CARD_GRADIENTS)]
        image = Image.new("RGB", (WIDTH, HEIGHT))
        draw = ImageDraw.Draw(image)
        for y in range(HEIGHT):
            t = y / (HEIGHT - 1)
            draw.line([(0, y), (WIDTH, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
        path = str((Path(out_dir) / f"{uuid.uuid4().hex}.jpg").as_posix())
        image.save(path, "JPEG", quality=92)
        paths.append(path)
    return paths


def _resolve_font_path() -> str | None:
    for candidate in _FONT_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    return None


# Emoji and other pictographs have no glyph in the bundled fonts, so
# they're stripped from text drawn onto the video.
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
    # The root cause is usually the *first* complaint; the tail is just
    # the resulting "Conversion failed" cascade.
    chosen = list(dict.fromkeys(interesting[:3] + interesting[-3:])) if interesting else lines[-6:]
    return " | ".join(chosen)[-1200:]


async def _run_ffmpeg(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=FFMPEG_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise ReelGenerationError(f"ffmpeg timed out after {FFMPEG_TIMEOUT_SECONDS}s")

    if proc.returncode == -9:
        raise ReelGenerationError("ffmpeg was killed (-9), most likely out of memory on this server")
    if proc.returncode != 0:
        raise ReelGenerationError(
            f"ffmpeg exited with code {proc.returncode}: "
            f"{_summarize_ffmpeg_error(stderr.decode(errors='replace'))}"
        )


# Sized for a small server (Fly shared-cpu-1x, 1GB): every thread holds its
# own full-resolution frames. -threads is per input/output, so it's
# repeated before each -i and the output.
FFMPEG_GLOBAL_ARGS = ["-filter_threads", "1", "-filter_complex_threads", "1"]
THREADS = ["-threads", "2"]
# No B-frames, so packet order is frame order and a segment's body can be cut
# out with a stream copy (see _join_segments) - all pieces share these
# settings, which is also what lets the concat demuxer join them unchanged.
SEGMENT_ENCODE_ARGS = [
    *THREADS, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-bf", "0", "-pix_fmt", "yuv420p",
]


@dataclass
class _Segment:
    src: str
    is_video: bool
    clip_len: float
    zoom_style: str = DEFAULT_ZOOM_STYLE
    color_filter: str = DEFAULT_COLOR_FILTER
    effect: str = DEFAULT_EFFECT
    # xfade transition into the next segment (unused on the last one).
    transition: str = DEFAULT_TRANSITION
    # Offset into a video source - Fast Cuts takes several clips from one.
    start: float = 0.0
    # Index of the source clip this came from (None for intro/outro cards).
    source: int | None = None
    # The template governing this clip (its own, else the reel's), and the
    # length of the transition out of it - templates differ in both.
    template: dict | None = None
    fade_out: float = XFADE_SECONDS
    # This clip's own text layers (see reel_text) - rendered to an overlay.
    text_layers: list[dict] = field(default_factory=list)
    # Full-frame RGBA PNGs laid over the segment, each with the second it
    # disappears at (None = the whole segment).
    overlays: list[tuple[str, float | None]] = field(default_factory=list)


async def _render_segment(seg: _Segment, out_path: str, fade_in_frames: int) -> None:
    """Renders one segment to exactly WIDTHxHEIGHT, FPS and clip_len in its
    own ffmpeg pass, overlays (text, logo, template graphics) included. Rendering every segment
    inside one big filtergraph peaked at ~1.3GB (ffmpeg keeps frames of all
    inputs in flight at once) - more than the whole server has.

    Stills get the Ken Burns zoom. Video clips (any aspect ratio - AI models
    mostly render landscape) are looped or cut to length and fitted onto a
    blurred, cropped copy of themselves rather than cropped down.
    """
    looks = [COLOR_FILTERS.get(seg.color_filter, ""), EFFECTS.get(seg.effect, "")]
    color = "".join(f"{look}," for look in looks if look)
    frames = max(1, round(seg.clip_len * FPS))

    if seg.is_video:
        # Blur a downscaled copy and scale it back up - same look, a
        # fraction of the memory/CPU of blurring at full resolution.
        graph = (
            f"[0:v]fps={FPS},setpts=PTS-STARTPTS,split=2[bg][fg];"
            f"[bg]scale={WIDTH // 4}:{HEIGHT // 4}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH // 4}:{HEIGHT // 4},boxblur=5:2,scale={WIDTH}:{HEIGHT}[bgb];"
            f"[fg]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease[fgs];"
            f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,{color}null[base]"
        )
        start = ["-ss", f"{seg.start:.3f}"] if seg.start > 0 else []
        inputs = [*THREADS, "-stream_loop", "-1", *start, "-t", f"{seg.clip_len:.3f}", "-i", seg.src]
    else:
        zoom_z, zoom_x, zoom_y = (
            expr.replace("{d}", str(frames))
            for expr in ZOOM_STYLES.get(seg.zoom_style, ZOOM_STYLES[DEFAULT_ZOOM_STYLE])
        )
        # A single decoded frame in; zoompan emits all `frames` from it.
        # The look is applied per frame after the motion (grain moves).
        graph = (
            f"[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH}:{HEIGHT},setsar=1,"
            f"zoompan=z='{zoom_z}':x='{zoom_x}':y='{zoom_y}':d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},{color}null[base]"
        )
        inputs = [*THREADS, "-i", seg.src]

    prev = "base"
    for k, (png, until) in enumerate(seg.overlays, start=1):
        inputs += ["-loop", "1", "-i", png]
        enable = f":enable='lt(t,{until:.3f})'" if until is not None else ""
        graph += f";[{prev}][{k}:v]overlay=0:0:shortest=1{enable}[ov{k}]"
        prev = f"ov{k}"
    graph += f";[{prev}]{SEGMENT_TAIL}[out]"

    await _run_ffmpeg([
        "ffmpeg", "-y", *FFMPEG_GLOBAL_ARGS, *inputs,
        "-filter_complex", graph, "-map", "[out]", "-an", "-frames:v", str(frames),
        *SEGMENT_ENCODE_ARGS,
        # Keyframes where _join_segments cuts the body out.
        "-force_key_frames", f"expr:eq(n,0)+eq(n,{fade_in_frames})",
        out_path,
    ])


async def _join_segments(
    segment_paths: list[str], clip_lens: list[float], transitions: list[str], fades: list[float], work_dir: str
) -> str:
    """Joins rendered segments with an xfade between neighbours, returning
    the joined video's path (inside work_dir).

    Chaining xfades over all segments in one filtergraph also blew the
    memory budget (frames of the later inputs pile up while xfade is still
    on the first). Instead only each transition is rendered (from two
    transition-long inputs), the untouched middle "body" of each segment is stream-copied
    out, and the pieces are concatenated without re-encoding - giving the
    same timeline as chained xfades: body0, t01, body1, t12, ..., body_last.
    `fades[i]` is the length of the transition out of segment i.
    """
    n = len(segment_paths)
    pieces: list[str] = []

    def piece_path(name: str) -> str:
        return str(Path(work_dir) / name)

    for i in range(n):
        frames = max(1, round(clip_lens[i] * FPS))
        fade_frames = round(fades[i] * FPS)
        start = round(fades[i - 1] * FPS) if i > 0 else 0
        end = frames - fade_frames if i < n - 1 else frames
        if end > start:
            body = piece_path(f"body_{i}.mp4")
            await _run_ffmpeg([
                "ffmpeg", "-y", "-ss", f"{start / FPS:.3f}", "-i", segment_paths[i],
                "-map", "0:v", "-frames:v", str(end - start), "-c", "copy", body,
            ])
            pieces.append(body)

        if i < n - 1:
            xfade = transitions[i] if transitions[i] in XFADE_TRANSITIONS else DEFAULT_TRANSITION
            transition = piece_path(f"xfade_{i}.mp4")
            await _run_ffmpeg([
                "ffmpeg", "-y", *FFMPEG_GLOBAL_ARGS,
                *THREADS, "-ss", f"{(frames - fade_frames) / FPS:.3f}", "-i", segment_paths[i],
                *THREADS, "-t", f"{fades[i]:.3f}", "-i", segment_paths[i + 1],
                "-filter_complex",
                f"[0:v]setpts=PTS-STARTPTS,{SEGMENT_TAIL}[a];[1:v]setpts=PTS-STARTPTS,{SEGMENT_TAIL}[b];"
                f"[a][b]xfade=transition={xfade}:duration={fades[i]:.3f}:offset=0,{SEGMENT_TAIL}[out]",
                "-map", "[out]", "-an", "-frames:v", str(fade_frames), *SEGMENT_ENCODE_ARGS, transition,
            ])
            pieces.append(transition)

    list_file = piece_path("concat.txt")
    Path(list_file).write_text("".join(f"file '{p}'\n" for p in pieces))
    joined = piece_path("joined.mp4")
    await _run_ffmpeg([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", joined,
    ])
    return joined


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
    template_id: str | None = None,
    brand: dict | None = None,
    ctas: list[dict] | None = None,
    clip_templates: list[str | None] | None = None,
    effects: list[str] | None = None,
) -> list[str]:
    """Renders `out_path` (mp4) from the given ordered source paths. Each
    source is a still image or a video clip (by file extension); the
    "image" naming below predates video segments and covers both.

    `text_layers` are drawn over the whole video and `image_text_layers[i]`
    only while image i is on screen (see reel_text for the layer shape).
    Only these user-added layers are drawn - `caption` is the post's text
    and never goes on the video.

    `audio_path` ("music") and `voice_audio_path` ("voiceover") are two
    independent optional tracks, each with its own [start, end) trim. With
    both given, the music is auto-ducked under the voice track (via a
    sidechain compressor keyed off the voice's level) and the two are mixed;
    with only one given, that track alone is used as-is; with neither, the
    video is silent (a muted track is still added - some platforms mishandle
    video with zero audio streams). A track is padded with silence if
    shorter than the video, hard-capped to the video's length, and given a
    1s fade-out - it plays once, not looped.

    `image_durations[i]` is image i's own on-screen duration in seconds
    (before crossfade overlap is subtracted) - when omitted (or the wrong
    length), defaults come from _default_clip_lens. The video's total length
    is whatever these sum to (minus overlaps).

    `zoom_styles[i]` (one per image) and `transitions[i]` (one per image,
    the crossfade used going into the next one - the last entry is unused)
    default to DEFAULT_ZOOM_STYLE/DEFAULT_TRANSITION for every image when
    not given, or for any entry missing from a too-short list.

    `template_id` (see reel_templates) adds the template's graphics, cards
    and cuts on top of the per-image settings above; `clip_templates[i]`
    overrides it for clip i alone (its letterbox/frame, video cuts and
    transition length). Intro/hook come from the first clip's template,
    the outro from the last clip's. `brand` is {color,
    title, cta, logo_path, logo_x, logo_y, logo_scale}: the logo (when
    uploaded) is drawn on every clip at its dragged position, whatever the
    template.

    `ctas` (see reel_text.normalize_cta) are animated badges placed on the
    reel's timeline: clip `clip`'s start + `offset`, for `duration` seconds,
    running on over later clips if long enough.

    Returns any warnings worth showing the user (the render still
    succeeded). Raises ReelGenerationError on any ffmpeg failure or timeout.
    """
    from app.services import reel_chrome
    from app.services.reel_templates import CARD_SECONDS, get_template

    template = get_template(template_id)
    brand = dict(brand or {})

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

    # Each clip's template: its own if set, else the reel's.
    clip_tpls = [get_template(t) for t in (clip_templates or [])[:n]]
    clip_tpls += [None] * (n - len(clip_tpls))
    seg_tpls = [clip_tpls[i] or template for i in range(n)]
    first_tpl, last_tpl = seg_tpls[0] or {}, seg_tpls[-1] or {}
    # Transition length: rhythm templates use quicker ones.
    reel_fade = _fade_of(template)

    card_count = int(bool(first_tpl.get("intro_card"))) + int(bool(last_tpl.get("outro_card")))
    if image_durations and len(image_durations) == n:
        clip_lens = [max(MIN_IMAGE_SECONDS, min(d, MAX_IMAGE_SECONDS)) for d in image_durations]
    else:
        # Intro/outro cards come out of the target length, not on top of it.
        content_seconds = max(MIN_IMAGE_SECONDS * n, target_seconds - card_count * (CARD_SECONDS - reel_fade))
        clip_lens = await _default_clip_lens(image_paths, content_seconds, reel_fade)
    is_video = [is_video_path(p) for p in image_paths]

    zoom_styles = (zoom_styles or [])[:n] + [DEFAULT_ZOOM_STYLE] * max(0, n - len(zoom_styles or []))
    transitions = (transitions or [])[:n] + [DEFAULT_TRANSITION] * max(0, n - len(transitions or []))
    color_filters = (color_filters or [])[:n] + [DEFAULT_COLOR_FILTER] * max(0, n - len(color_filters or []))
    effects = (effects or [])[:n] + [DEFAULT_EFFECT] * max(0, n - len(effects or []))

    global_layers = normalize_text_layers(text_layers)
    per_image_layers = [normalize_text_layers(layers) for layers in (image_text_layers or [])[:n]]
    per_image_layers += [[]] * (n - len(per_image_layers))
    warnings: list[str] = []

    segments = [
        _Segment(
            src=image_paths[i],
            is_video=is_video[i],
            clip_len=clip_lens[i],
            zoom_style=zoom_styles[i],
            color_filter=color_filters[i],
            effect=effects[i],
            transition=transitions[i],
            text_layers=per_image_layers[i],
            source=i,
            template=seg_tpls[i],
            fade_out=_fade_of(seg_tpls[i]),
        )
        for i in range(n)
    ]

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)

    work_dir = tempfile.mkdtemp(prefix="reel_")
    try:
        segments = await _rhythm_cuts(segments)
        _add_overlays(segments, brand, global_layers, work_dir, reel_chrome)
        segments = _add_cards(segments, first_tpl, last_tpl, brand, work_dir, reel_chrome, CARD_SECONDS)
        # Every clip needs room for its transitions in and out.
        for k, seg in enumerate(segments):
            fade_in = segments[k - 1].fade_out if k > 0 else 0.0
            fade_out = seg.fade_out if k < len(segments) - 1 else 0.0
            seg.clip_len = max(seg.clip_len, fade_in + fade_out + 0.2)

        total_seconds = sum(seg.clip_len for seg in segments) - sum(seg.fade_out for seg in segments[:-1])
        cta_inputs = _place_ctas(normalize_ctas(ctas, n), segments, total_seconds, work_dir, reel_chrome)

        # One at a time, so only one segment's frames are in memory at once.
        # Overlays are burned into each segment (whole-video ones into all
        # of them), so the transitions blend them like the rest of the
        # picture and the final pass never has to re-encode the video.
        segment_paths: list[str] = []
        for i, seg in enumerate(segments):
            segment_path = str(Path(work_dir) / f"segment_{i}.mp4")
            await _render_segment(seg, segment_path, round(segments[i - 1].fade_out * FPS) if i else 0)
            segment_paths.append(segment_path)
        joined_path = await _join_segments(
            segment_paths,
            [seg.clip_len for seg in segments],
            [seg.transition for seg in segments],
            [seg.fade_out for seg in segments],
            work_dir,
        )
        await _render_final(
            joined_path, out_path, total_seconds,
            audio_path, audio_start, audio_end, voice_audio_path, voice_audio_start, voice_audio_end,
            cta_inputs,
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    return warnings


def _rhythm(template: dict) -> list[float] | None:
    """The template's clip-length pattern, when it cuts videos to it."""
    if template.get("cut_videos") and template.get("durations"):
        return [float(d) for d in template["durations"]]
    if template.get("cut_seconds"):  # older single-length form
        return [float(template["cut_seconds"])]
    return None


def _fade_of(template: dict | None) -> float:
    return float((template or {}).get("xfade", XFADE_SECONDS))


async def _rhythm_cuts(segments: list[_Segment]) -> list[_Segment]:
    """Cuts each long-enough video into pieces following its template's
    duration pattern (different stretches of the source each time), with
    that template's transitions cycling between them - so a video fits the
    template's rhythm the same way a run of stills does."""
    expanded: list[_Segment] = []
    for seg in segments:
        tpl = seg.template or {}
        fade = seg.fade_out
        min_clip = max(MIN_IMAGE_SECONDS, 2 * fade + 0.2)
        pattern = [max(min_clip, d) for d in _rhythm(tpl) or []]
        if not pattern or not seg.is_video or seg.clip_len < min(pattern) * 1.5:
            expanded.append(seg)
            continue
        cycle = tpl.get("transitions") or [tpl.get("transition", DEFAULT_TRANSITION)]
        natural = await probe_duration(seg.src) or seg.clip_len

        # Piece lengths that fill the clip's slot, overlaps included.
        lengths: list[float] = []
        remaining = seg.clip_len
        while True:
            length = pattern[len(lengths) % len(pattern)]
            if remaining - (length - fade) < min_clip:
                lengths.append(remaining)
                break
            lengths.append(length)
            remaining -= length - fade

        source_t = 0.0
        for j, length in enumerate(lengths):
            expanded.append(replace(
                seg,
                # Own copies - overlays get appended per piece later.
                overlays=list(seg.overlays),
                text_layers=list(seg.text_layers),
                clip_len=length,
                start=source_t % max(natural, 0.1),
                transition=cycle[j % len(cycle)] if j < len(lengths) - 1 else seg.transition,
            ))
            source_t += length
    return expanded


def _add_overlays(
    segments: list[_Segment], brand: dict, global_layers: list[dict], work_dir: str, chrome
) -> None:
    """Per clip: its template's chrome + the logo + whole-video text as one
    overlay (shared by clips with the same template); the clip's own text
    as another; the hook title over the first seconds. Only user-entered
    text is ever drawn."""
    def png(name: str) -> str:
        return str(Path(work_dir) / name)

    statics: dict[str | None, str | None] = {}
    rendered: dict[int, str | None] = {}  # fast-cut pieces share their clip's layers
    for i, seg in enumerate(segments):
        key = (seg.template or {}).get("name")
        if key not in statics:
            statics[key] = chrome.render_overlay(
                png(f"static_{len(statics)}.png"), layers=global_layers, template=seg.template, brand=brand,
                with_logo=True,
            )
        if statics[key]:
            seg.overlays.append((statics[key], None))
        if seg.effect == "vhs_80s":
            if "vhs" not in statics:
                statics["vhs"] = chrome.render_vhs_stamp(png("vhs_stamp.png"))
            seg.overlays.append((statics["vhs"], None))
        if seg.text_layers:
            text_key = id(seg.text_layers[0])
            if text_key not in rendered:
                rendered[text_key] = chrome.render_overlay(png(f"text_{i}.png"), layers=seg.text_layers)
            if rendered[text_key]:
                seg.overlays.append((rendered[text_key], None))

    title = (brand.get("title") or "").strip()
    first_tpl = (segments[0].template if segments else None) or {}
    hook_seconds = first_tpl.get("hook_seconds")
    if hook_seconds and title:
        hook = chrome.render_hook(title, first_tpl.get("hook_style", "bold"), brand, png("hook.png"))
        if hook:
            segments[0].overlays.append((hook, min(hook_seconds, segments[0].clip_len)))


def _place_ctas(
    ctas: list[dict], segments: list[_Segment], total_seconds: float, work_dir: str, chrome
) -> list[tuple[str, float, int, int]]:
    """Renders each CTA's animation frames and works out where it starts on
    the joined timeline. Returns (frame pattern, start second, x, y)."""
    # Joined timeline: segment k starts where the previous one's crossfade
    # into it begins.
    clip_starts: dict[int, float] = {}
    t = 0.0
    for seg in segments:
        if seg.source is not None:
            clip_starts.setdefault(seg.source, t)
        t += seg.clip_len - seg.fade_out

    placed: list[tuple[str, float, int, int]] = []
    for i, cta in enumerate(ctas):
        start = clip_starts.get(cta["clip"], 0.0) + cta["offset"]
        if start >= total_seconds - 0.2:
            continue  # starts after the reel ends
        cta = {**cta, "duration": min(cta["duration"], total_seconds - start)}
        pattern, x, y = chrome.render_cta_frames(cta, str(Path(work_dir) / f"cta_{i}"), FPS)
        placed.append((pattern, start, x, y))
    return placed


def _add_cards(
    segments: list[_Segment], first_tpl: dict, last_tpl: dict, brand: dict, work_dir: str, chrome,
    card_seconds: float,
) -> list[_Segment]:
    """Intro card per the first clip's template, outro per the last's."""
    def card(name: str, title: str, fade: float) -> _Segment:
        path = chrome.render_card(title, "", brand, str(Path(work_dir) / name))
        return _Segment(
            src=path, is_video=False, clip_len=card_seconds, zoom_style="zoom_in", transition="fade", fade_out=fade
        )

    if first_tpl.get("intro_card"):
        segments = [card("intro.jpg", brand.get("title") or "", _fade_of(first_tpl))] + segments
    if last_tpl.get("outro_card"):
        segments[-1].transition = "fade"
        segments[-1].fade_out = _fade_of(last_tpl)
        segments = segments + [card("outro.jpg", brand.get("outro") or "", _fade_of(last_tpl))]
    return segments


async def _render_final(
    joined_path: str,
    out_path: str,
    total_seconds: float,
    audio_path: str | None,
    audio_start: float,
    audio_end: float | None,
    voice_audio_path: str | None,
    voice_audio_start: float,
    voice_audio_end: float | None,
    cta_inputs: list[tuple[str, float, int, int]] = (),
) -> None:
    """Muxes the joined video with the audio. The video is copied as-is,
    unless there are CTAs to animate over it - they live on the whole-reel
    timeline (and can span clips), so they're overlaid here, re-encoding
    the video once with a single video input."""
    cmd: list[str] = ["ffmpeg", "-y", *FFMPEG_GLOBAL_ARGS, *THREADS, "-i", joined_path]

    next_index = 1
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

    video_parts: list[str] = []
    video_map = "0:v"
    if cta_inputs:
        prev = "0:v"
        for k, (pattern, start, x, y) in enumerate(cta_inputs):
            # Offset so the sequence's first frame lands at `start`; the
            # overlay passes the video through before and after it.
            cmd += ["-itsoffset", f"{start:.3f}", "-framerate", str(FPS), "-i", pattern]
            label = f"vcta{k}"
            video_parts.append(f"[{prev}][{next_index}:v]overlay={x}:{y}:eof_action=pass:format=auto[{label}]")
            prev = label
            next_index += 1
        video_parts.append(f"[{prev}]{SEGMENT_TAIL}[vout]")
        video_map = "[vout]"

    if audio_parts or video_parts:
        cmd += ["-filter_complex", ";".join(video_parts + audio_parts)]
    cmd += ["-map", video_map, "-map", audio_map]
    cmd += [
        *(SEGMENT_ENCODE_ARGS if cta_inputs else ["-c:v", "copy"]),
        "-movflags", "+faststart",
        "-c:a", "aac",
        # Not -shortest: every audio branch is already trimmed/padded to
        # total_seconds, and -shortest made ffmpeg buffer ~900MB of frames
        # to line the streams up.
        "-t", f"{total_seconds:.3f}",
        out_path,
    ]

    await _run_ffmpeg(cmd)
