"""Turns a plain-language request ("make it faster, add 'Sale 50% off' at
the top") into a patch of the reel's existing settings, via any
OpenAI-compatible chat API (HF's router by default).

The model only ever proposes values; everything is validated against the
same whitelists the regenerate endpoint uses, so a bad or hallucinated
answer can't produce an invalid render.
"""

import json
import logging
import re

import httpx

from app.core.config import settings
from app.services.reel_generator import COLOR_FILTERS, XFADE_TRANSITIONS, ZOOM_STYLES
from app.services.reel_templates import REEL_TEMPLATES
from app.services.reel_text import (
    CTA_ANIMATIONS,
    FONTS,
    MAX_CTAS,
    MAX_FONT_SIZE,
    MAX_TEXT_LAYERS,
    MIN_FONT_SIZE,
    normalize_ctas,
    normalize_text_layers,
)

logger = logging.getLogger("scheduler.ai_editor")

MIN_SECONDS = 15
MAX_SECONDS = 90
MAX_INSTRUCTION_CHARS = 500
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class AIEditError(Exception):
    pass


def is_enabled() -> bool:
    return bool(settings.ai_edit_api_key or settings.hf_token)


def _system_prompt(current: dict) -> str:
    templates = ", ".join(f"{tid} ({t['name']}: {t['description']})" for tid, t in REEL_TEMPLATES.items())
    return f"""You edit the settings of a short vertical social-media video (a "reel").
Reply with ONLY a JSON object - no prose, no code fences - using any of these optional keys:
- "template": one of [{", ".join(REEL_TEMPLATES)}] or "none". Templates: {templates}
- "transition": one of [{", ".join(XFADE_TRANSITIONS)}] (used between every clip)
- "zoom_style": one of [{", ".join(ZOOM_STYLES)}]
- "color_filter": one of [{", ".join(COLOR_FILTERS)}]
- "target_seconds": number between {MIN_SECONDS} and {MAX_SECONDS} (total video length)
- "text_layers": list (max {MAX_TEXT_LAYERS}) of {{"text", "font" (one of [{", ".join(FONTS)}]; use "hind" for Hindi/Devanagari text), "font_size" ({MIN_FONT_SIZE}-{MAX_FONT_SIZE}, 56 is normal), "color" ("#RRGGBB"), "x" and "y" (centre of the text, 0-1 fractions of the frame: y 0.08 = top, 0.5 = middle, 0.88 = bottom), "background" (true for a dark box behind the text)}} - REPLACES all text shown over the whole video; keep existing layers you aren't asked to change; send [] to remove text
- "title_text": the big title shown by the Bold Hook / Cinematic / Intro templates
- "ctas": list (max {MAX_CTAS}) of animated call-to-action buttons {{"text", "link" (URL or null - added to the post text, since videos can't hold links), "clip" (0-based index of the clip it appears on; clip_count is in current settings), "offset" (seconds into that clip it pops up), "duration" (seconds it stays; may run over later clips), "x" and "y" (centre, 0-1 fractions), "animation" (one of [{", ".join(CTA_ANIMATIONS)}]), "bg_color" and "text_color" ("#RRGGBB"), "font", "font_size"}} - REPLACES all CTAs; keep existing ones you aren't asked to change; send [] to remove them
- "brand_color": "#RRGGBB" used by template bars, frames and cards
- "reply": REQUIRED. One short sentence telling the user what you changed, in the same language and script the user wrote in.
Include only keys that should change. Never copy the post caption onto the video unless the user explicitly asks for that text. If the request can't be done with these settings, return only "reply" explaining why.
"Faster"/"energetic" usually means a shorter target_seconds and slide/zoom transitions; "calm"/"elegant" means fades.
Current settings: {json.dumps(current, ensure_ascii=False)}"""


def _extract_json(content: str) -> dict:
    match = re.search(r"\{.*\}", content or "", re.DOTALL)
    if not match:
        raise AIEditError("The AI didn't return any changes - try rephrasing")
    try:
        data = json.loads(match.group(0))
    except ValueError as exc:
        raise AIEditError("The AI returned an unreadable answer - try again") from exc
    if not isinstance(data, dict):
        raise AIEditError("The AI returned an unreadable answer - try again")
    return data


def validate_patch(data: dict) -> tuple[dict, str]:
    """Keeps only valid, known keys. Returns (patch, reply)."""
    patch: dict = {}
    template = data.get("template")
    if template == "none" or template in REEL_TEMPLATES:
        patch["template"] = None if template == "none" else template
    if data.get("transition") in XFADE_TRANSITIONS:
        patch["transition"] = data["transition"]
    if data.get("zoom_style") in ZOOM_STYLES:
        patch["zoom_style"] = data["zoom_style"]
    if data.get("color_filter") in COLOR_FILTERS:
        patch["color_filter"] = data["color_filter"]
    if isinstance(data.get("target_seconds"), (int, float)):
        patch["target_seconds"] = max(MIN_SECONDS, min(float(data["target_seconds"]), MAX_SECONDS))
    if isinstance(data.get("text_layers"), list):
        patch["text_layers"] = normalize_text_layers(data["text_layers"])
    if isinstance(data.get("ctas"), list):
        # Clip indices are clamped against the real clip count by the caller.
        patch["ctas"] = normalize_ctas(data["ctas"], MAX_CTAS * 100)
    for key in ("title_text",):
        if isinstance(data.get(key), str):
            patch[key] = data[key].strip()[:120] or None
    if isinstance(data.get("brand_color"), str) and _HEX.match(data["brand_color"]):
        patch["brand_color"] = data["brand_color"]
    reply = str(data.get("reply") or "").strip()[:300] or ("Done." if patch else "I couldn't change anything for that.")
    return patch, reply


async def propose_edit(instruction: str, current: dict) -> tuple[dict, str]:
    if not is_enabled():
        raise AIEditError("AI editing isn't configured on the server (set HF_TOKEN or AI_EDIT_API_KEY)")

    payload = {
        "model": settings.ai_edit_model,
        "messages": [
            {"role": "system", "content": _system_prompt(current)},
            {"role": "user", "content": instruction[:MAX_INSTRUCTION_CHARS]},
        ],
        "temperature": 0.2,
        "max_tokens": 700,
    }
    headers = {"Authorization": f"Bearer {settings.ai_edit_api_key or settings.hf_token}"}
    url = f"{settings.ai_edit_base_url.rstrip('/')}/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise AIEditError(f"Couldn't reach the AI service: {exc}") from exc

    if response.status_code == 402:
        raise AIEditError("AI credits exhausted (402) - add credits or wait for the monthly reset")
    if response.status_code in (401, 403):
        raise AIEditError(f"The AI service rejected the API key ({response.status_code})")
    if response.status_code == 429:
        raise AIEditError("The AI service is rate-limiting requests - try again in a minute")
    if response.status_code >= 400:
        raise AIEditError(f"AI request failed ({response.status_code}): {response.text[:200]}")

    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIEditError("The AI service returned an unexpected response") from exc

    logger.info("AI edit proposal: %s", content[:500])
    return validate_patch(_extract_json(content))
