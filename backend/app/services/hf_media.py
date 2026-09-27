"""Hugging Face wrappers used for AI reel footage.

Each task tries two routes, both authenticated with HF_TOKEN and neither
downloading or deploying a model here:
1. A public Gradio Space on ZeroGPU (free - spends the account's daily
   ZeroGPU minutes), via gradio_client.
2. Inference Providers through HF's router (billed against HF credits).

Both clients are synchronous, so calls run in a worker thread to keep the
event loop (and the other scheduler jobs) responsive while a video renders
remotely.
"""

import asyncio
import logging
import shutil
from pathlib import Path

from gradio_client import Client as SpaceClient
from gradio_client import handle_file
from huggingface_hub import InferenceClient
from huggingface_hub.errors import HfHubHTTPError

from app.core.config import settings

logger = logging.getLogger("scheduler.hf_media")

# Portrait, so generated media needs little cropping for a 1080x1920 reel.
SCENE_IMAGE_WIDTH = 768
SCENE_IMAGE_HEIGHT = 1344
SPACE_VIDEO_WIDTH = 512
SPACE_VIDEO_HEIGHT = 768
SPACE_VIDEO_SECONDS = 5.0


class HFMediaError(Exception):
    pass


def is_enabled() -> bool:
    return bool(settings.hf_token)


def _client() -> InferenceClient:
    return InferenceClient(
        provider=settings.hf_provider,
        api_key=settings.hf_token,
        timeout=settings.hf_timeout_seconds,
    )


def _describe_error(exc: Exception) -> str:
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status == 402:
        return "Hugging Face credits exhausted (402) - add credits or wait for the monthly reset"
    if status in (401, 403):
        return f"Hugging Face rejected HF_TOKEN ({status}) - it needs the 'Inference Providers' permission"
    if status == 404:
        return f"No Hugging Face inference provider serves this model/task ({status})"
    return f"Hugging Face request failed: {str(exc)[:300]}"


async def _run(fn, *args, **kwargs):
    if not is_enabled():
        raise HFMediaError("HF_TOKEN is not set")
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    except HfHubHTTPError as exc:
        raise HFMediaError(_describe_error(exc)) from exc
    except Exception as exc:
        raise HFMediaError(f"Hugging Face request failed: {str(exc)[:300]}") from exc


def _space_output_path(result) -> str:
    """Spaces return (media, seed); media is a filepath, or a dict holding
    one under 'video'/'path' depending on the component."""
    media = result[0] if isinstance(result, (list, tuple)) else result
    if isinstance(media, dict):
        media = media.get("video") or media.get("path")
    if not media or not Path(str(media)).is_file():
        raise HFMediaError(f"Space returned no file: {str(result)[:200]}")
    return str(media)


async def _run_space(space: str, api_name: str, **inputs) -> str:
    if not is_enabled():
        raise HFMediaError("HF_TOKEN is not set")

    def call() -> str:
        client = SpaceClient(space, token=settings.hf_token, verbose=False)
        return _space_output_path(client.predict(api_name=api_name, **inputs))

    try:
        return await asyncio.wait_for(asyncio.to_thread(call), timeout=settings.hf_timeout_seconds)
    except HFMediaError:
        raise
    except asyncio.TimeoutError as exc:
        raise HFMediaError(f"Space {space} timed out") from exc
    except Exception as exc:
        # Quota exhaustion arrives as an AppError whose message mentions
        # the GPU quota - pass the message through so the user sees why.
        raise HFMediaError(f"Space {space} failed: {str(exc)[:300]}") from exc


async def _space_then_providers(task: str, space: str, via_space, via_providers) -> None:
    space_error: HFMediaError | None = None
    if space:
        try:
            await via_space()
            return
        except HFMediaError as exc:
            logger.info("Free Space route failed for %s, trying Inference Providers: %s", task, exc)
            space_error = exc
    try:
        await via_providers()
    except HFMediaError as exc:
        raise HFMediaError(f"{space_error}; then {exc}" if space_error else str(exc)) from exc


async def text_to_video(prompt: str, out_path: str) -> str:
    async def via_space():
        path = await _run_space(
            settings.hf_space_text_to_video,
            "/text_to_video",
            prompt=prompt,
            input_image_filepath=None,
            input_video_filepath=None,
            height_ui=SPACE_VIDEO_HEIGHT,
            width_ui=SPACE_VIDEO_WIDTH,
            mode="text-to-video",
            duration_ui=SPACE_VIDEO_SECONDS,
        )
        shutil.copyfile(path, out_path)

    async def via_providers():
        data = await _run(_client().text_to_video, prompt, model=settings.hf_video_model)
        Path(out_path).write_bytes(data)

    await _space_then_providers("text-to-video", settings.hf_space_text_to_video, via_space, via_providers)
    return out_path


async def image_to_video(image_path: str, prompt: str, out_path: str) -> str:
    async def via_space():
        path = await _run_space(
            settings.hf_space_image_to_video,
            "/generate_video",
            input_image=handle_file(image_path),
            prompt=prompt,
            duration_seconds=SPACE_VIDEO_SECONDS,
        )
        shutil.copyfile(path, out_path)

    async def via_providers():
        data = await _run(
            _client().image_to_video, Path(image_path).read_bytes(), prompt=prompt, model=settings.hf_video_model
        )
        Path(out_path).write_bytes(data)

    await _space_then_providers("image-to-video", settings.hf_space_image_to_video, via_space, via_providers)
    return out_path


async def text_to_image(prompt: str, out_path: str) -> str:
    from PIL import Image

    async def via_space():
        path = await _run_space(
            settings.hf_space_text_to_image,
            "/infer",
            prompt=prompt,
            width=SCENE_IMAGE_WIDTH,
            height=SCENE_IMAGE_HEIGHT,
        )
        # Spaces often hand back webp - normalize to the jpg the reel expects.
        Image.open(path).convert("RGB").save(out_path, "JPEG", quality=92)

    async def via_providers():
        image = await _run(
            _client().text_to_image,
            prompt,
            model=settings.hf_image_model,
            width=SCENE_IMAGE_WIDTH,
            height=SCENE_IMAGE_HEIGHT,
        )
        image.convert("RGB").save(out_path, "JPEG", quality=92)

    await _space_then_providers("text-to-image", settings.hf_space_text_to_image, via_space, via_providers)
    return out_path
