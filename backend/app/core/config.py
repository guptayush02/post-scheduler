from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "scheduler"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expires_days: int = 7

    uploads_dir: str = "uploads"

    frontend_base_url: str = "http://localhost:5173"

    # Path to the built frontend (npm run build output) - if this directory
    # exists at startup, the backend serves it directly (single-service
    # production deploys). Absent in local dev, where Vite's own dev server
    # + proxy handles the frontend instead.
    frontend_dist_dir: str = "frontend_dist"

    # Cookies are only marked Secure once served over real HTTPS (e.g. Fly.io
    # in production) - keep false for local http:// dev.
    cookie_secure: bool = False

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "no-reply@scheduler.local"

    fb_app_id: str | None = None
    fb_app_secret: str | None = None
    fb_graph_version: str = "v26.0"

    # Required, no default - must come from .env / Fly secrets. Must exactly
    # match a redirect URI registered in the Meta App's Facebook Login settings.
    fb_oauth_redirect_uri: str

    # Permissions requested on the Facebook OAuth dialog - without this,
    # Facebook shows "This app needs at least one supported permission".
    # Meta renamed the Instagram scopes (instagram_basic ->
    # instagram_business_basic, instagram_content_publish ->
    # instagram_business_content_publish) - must match whatever the App
    # Review permissions list in the Meta dashboard actually has configured,
    # or the OAuth dialog silently drops the unrecognized ones.
    fb_oauth_scopes: str = (
        "pages_show_list,pages_read_engagement,pages_manage_posts,"
        "pages_manage_metadata,instagram_business_basic,"
        "instagram_business_content_publish,business_management"
    )

    config_id: int | None = None

    # Fernet key for encrypting stored access/refresh tokens at rest.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    token_encryption_key: str = ""

    # Public HTTPS base URL (e.g. an ngrok tunnel to this backend) used to build
    # a publicly-fetchable media URL for Instagram's Content Publishing API,
    # which cannot accept direct file uploads like Facebook can. Leave blank
    # until you have one - Instagram cross-posting will report a clear error
    # instead of silently failing.
    public_base_url: str = ""

    # "Edit with AI" on the reel preview: any OpenAI-compatible chat API.
    # Defaults to Hugging Face's router with HF_TOKEN; e.g. Google Gemini's
    # free tier works with base URL
    # https://generativelanguage.googleapis.com/v1beta/openai, a Gemini API
    # key and model "gemini-2.0-flash".
    ai_edit_base_url: str = "https://router.huggingface.co/v1"
    ai_edit_api_key: str = ""
    ai_edit_model: str = "meta-llama/Llama-3.1-8B-Instruct"

    # Reel output size. 720x1280 keeps rendering within a small server
    # (Fly shared-cpu-1x, 1GB) - 1080x1920 is ~2.25x the CPU and memory.
    reel_width: int = 720
    reel_height: int = 1280

    # Hugging Face Inference Providers - optional AI footage for reels. With
    # no token, reels still generate (title cards / uploaded media only).
    # Free accounts get a small monthly credit; a 402 from HF means it ran
    # out, and the reel falls back to the non-AI path with a warning.
    hf_token: str = ""
    hf_provider: str = "auto"
    hf_video_model: str = "Wan-AI/Wan2.2-TI2V-5B"
    hf_image_model: str = "black-forest-labs/FLUX.1-schnell"
    # How many ~5s AI video clips to generate per reel - each one is billed.
    hf_video_clips: int = 1
    # Still images generated for a text-only reel (then Ken Burns'd by ffmpeg).
    hf_scene_images: int = 4
    hf_timeout_seconds: float = 600.0
    # Free path, tried before the (billed) Inference Providers above: public
    # Gradio Spaces on ZeroGPU, called with the same token - they use the
    # account's daily ZeroGPU minutes instead of credits. Blank one to skip
    # it. Third-party Spaces can change or go away; failures just fall
    # through to Inference Providers, then to the non-AI path.
    hf_space_text_to_video: str = "Lightricks/ltx-video-distilled"
    hf_space_image_to_video: str = "zerogpu-aoti/wan2-2-fp8da-aoti-faster"
    hf_space_text_to_image: str = "black-forest-labs/FLUX.1-schnell"


settings = Settings()
