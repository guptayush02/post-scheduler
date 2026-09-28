"""Reel templates: named presets of the reel generator's existing controls
(transition, zoom, colour grade) plus template-only "chrome" - letterbox
bars, a brand-colour frame, a hook title over the opening seconds,
intro/outro cards, and fast cuts. Calls to action are separate from
templates (see reel_text's CTAs) and work with any of them.

Templates never put the post caption on the video: the hook title and
cards only show text the user typed into the preview page, and are left out
when that's empty.

The same dicts are served to the frontend (GET /api/posts/reel-templates),
which draws its live preview from them, so both sides stay in step.
"""

DEFAULT_BRAND_COLOR = "#4F46E5"

REEL_TEMPLATES: dict[str, dict] = {
    "hook_caption": {
        "name": "Bold Hook",
        "description": "Your title big and bold over the first seconds, punchy slide-up transitions.",
        "transition": "slideup",
        "zoom_style": "zoom_in",
        "color_filter": "vivid",
        "hook_seconds": 2.5,
        "hook_style": "bold",
    },
    "cinematic": {
        "name": "Cinematic",
        "description": "Letterbox bars, warm grade, slow fades and an elegant centred title.",
        "transition": "fade",
        "zoom_style": "zoom_in",
        "color_filter": "warm",
        "letterbox": True,
        "hook_seconds": 3.0,
        "hook_style": "elegant",
    },
    "brand_frame": {
        "name": "Brand Frame",
        "description": "A brand-colour frame around the whole video, with sliding transitions.",
        "transition": "slideleft",
        "zoom_style": "zoom_in",
        "color_filter": "none",
        "frame": True,
    },
    "fast_cuts": {
        "name": "Fast Cuts",
        "description": "Chops videos into short clips with quick, punchy transitions.",
        "transitions": ["zoomin", "slideleft", "slideup", "circleopen", "smoothright"],
        "transition": "zoomin",
        "zoom_style": "zoom_in",
        "color_filter": "vivid",
        "durations": [2.5],
        "cut_videos": True,
        "xfade": 0.6,
    },
    "intro_outro": {
        "name": "Intro + Outro",
        "description": "Opens on a brand-colour card with your logo and title, and ends on one with your first call to action.",
        "transition": "fade",
        "zoom_style": "zoom_in",
        "color_filter": "none",
        "intro_card": True,
        "outro_card": True,
    },
    "product_showcase": {
        "name": "Product Showcase",
        "description": "Vivid colours and smooth sliding transitions - add a text per clip to label each product.",
        "transition": "smoothleft",
        "zoom_style": "zoom_in",
        "color_filter": "vivid",
    },
    # --- Rhythm templates: a transition sequence, a clip-length pattern and
    # a motion pattern that repeat across however many images/videos are
    # added - videos get cut to the same pattern ("cut_videos"), so any mix
    # of media falls into the template's rhythm. "xfade" = transition length.
    "swipe_story": {
        "name": "Swipe Story",
        "description": "Clips swipe in alternately from the right and left, like flicking through a story.",
        "transitions": ["slideleft", "slideright"],
        "transition": "slideleft",
        "zoom_styles": ["zoom_in", "zoom_out"],
        "zoom_style": "zoom_in",
        "color_filter": "none",
        "durations": [3.0],
        "cut_videos": True,
        "xfade": 0.5,
    },
    "beat_sync": {
        "name": "Beat Sync",
        "description": "Short-short-long rhythm with zoom, flash and circle transitions - pair it with a music track.",
        "transitions": ["zoomin", "fadewhite", "circleopen"],
        "transition": "zoomin",
        "zoom_styles": ["zoom_in", "zoom_in", "zoom_out"],
        "zoom_style": "zoom_in",
        "color_filter": "vivid",
        "durations": [1.5, 1.5, 3.0],
        "cut_videos": True,
        "xfade": 0.4,
    },
    "glitch_pop": {
        "name": "Glitch Pop",
        "description": "Rapid pixel, wind and squeeze transitions every 2 seconds for an edgy, energetic feel.",
        "transitions": ["pixelize", "hlwind", "squeezeh", "hrwind", "squeezev"],
        "transition": "pixelize",
        "zoom_styles": ["zoom_in"],
        "zoom_style": "zoom_in",
        "color_filter": "vivid",
        "durations": [2.0],
        "cut_videos": True,
        "xfade": 0.4,
    },
    "smooth_flow": {
        "name": "Smooth Flow",
        "description": "Each clip glides in from a new direction while the picture slowly pans - calm and polished.",
        "transitions": ["smoothup", "smoothleft", "smoothdown", "smoothright"],
        "transition": "smoothup",
        "zoom_styles": ["pan_right", "pan_left"],
        "zoom_style": "pan_right",
        "color_filter": "cool",
        "durations": [3.5],
        "cut_videos": True,
        "xfade": 0.8,
    },
    "circle_reveal": {
        "name": "Circle Reveal",
        "description": "Every clip opens out of a circle, then zooms gently.",
        "transitions": ["circleopen", "circleclose", "radial"],
        "transition": "circleopen",
        "zoom_styles": ["zoom_in", "zoom_out"],
        "zoom_style": "zoom_in",
        "color_filter": "none",
        "durations": [3.0],
        "cut_videos": True,
        "xfade": 0.7,
    },
    "wipe_montage": {
        "name": "Wipe Montage",
        "description": "Diagonal and corner wipes with pans in alternating directions - a classic montage.",
        "transitions": ["wipetl", "wipebr", "diagtr", "diagbl"],
        "transition": "wipetl",
        "zoom_styles": ["pan_left", "zoom_in", "pan_right"],
        "zoom_style": "pan_left",
        "color_filter": "none",
        "durations": [2.5],
        "cut_videos": True,
        "xfade": 0.6,
    },
    "flash_cuts": {
        "name": "Flash Cuts",
        "description": "Quick white-flash cuts between short clips - great for before/after and reveals.",
        "transitions": ["fadewhite"],
        "transition": "fadewhite",
        "zoom_styles": ["zoom_in", "zoom_out"],
        "zoom_style": "zoom_in",
        "color_filter": "vivid",
        "durations": [1.8],
        "cut_videos": True,
        "xfade": 0.3,
    },
    "dreamy_fade": {
        "name": "Dreamy Fade",
        "description": "Long, soft dissolves and fades through black over warm, slowly zooming clips.",
        "transitions": ["dissolve", "fadeblack", "fadeslow"],
        "transition": "dissolve",
        "zoom_styles": ["zoom_out", "zoom_in"],
        "zoom_style": "zoom_out",
        "color_filter": "warm",
        "durations": [4.5],
        "cut_videos": True,
        "xfade": 1.2,
    },
}

# Seconds each intro/outro card stays on screen.
CARD_SECONDS = 3.0


def cycle(values: list, i: int):
    return values[i % len(values)]


def slot_settings(template: dict, pos: int) -> dict:
    """What the template gives the clip at on-screen position `pos`: its
    transition out, motion, and (for rhythm templates) length."""
    return {
        "transition": cycle(template.get("transitions") or [template["transition"]], pos),
        "zoom_style": cycle(template.get("zoom_styles") or [template["zoom_style"]], pos),
        "duration": cycle(template["durations"], pos) if template.get("durations") else None,
    }


def get_template(template_id: str | None) -> dict | None:
    return REEL_TEMPLATES.get(template_id or "")


def public_templates() -> list[dict]:
    return [{"id": template_id, **template} for template_id, template in REEL_TEMPLATES.items()]


async def apply_template(post, template_id: str | None) -> None:
    """Switches the reel to `template_id` (None = no template), restyling
    every clip to the template's look by its position: the transition and
    motion sequences, and for rhythm templates the clip-length pattern
    (videos keep their full length and get cut to the rhythm at render).
    Per-image tweaks made afterwards still win, since they're what's stored.
    Mirrors onPickTemplate in the frontend's PostPreviewPage. (`post` is a
    ScheduledPost; not saved here.)"""
    from app.core.media import resolve_media_path
    from app.services.reel_generator import MAX_IMAGE_SECONDS, MIN_IMAGE_SECONDS, is_video_path, probe_duration

    template = get_template(template_id)
    post.reel_template = template_id if template else None
    post.reel_clip_templates = None  # a whole-reel pick replaces per-clip ones
    if not template:
        return
    sources = post.reel_source_images or []
    n = len(sources)
    post.reel_transition = template["transition"]
    post.reel_zoom_style = template["zoom_style"]
    if not n:
        return
    slots = [slot_settings(template, pos) for pos in range(n)]
    post.reel_image_transitions = [slot["transition"] for slot in slots]
    post.reel_image_zoom_styles = [slot["zoom_style"] for slot in slots]
    post.reel_image_color_filters = [template["color_filter"]] * n
    if template.get("durations"):
        durations: list[float] = []
        for path, slot in zip(sources, slots):
            if is_video_path(path):
                natural = await probe_duration(str(resolve_media_path(path))) or slot["duration"]
                durations.append(max(MIN_IMAGE_SECONDS, min(natural, MAX_IMAGE_SECONDS)))
            else:
                durations.append(slot["duration"])
        post.reel_image_durations = durations
