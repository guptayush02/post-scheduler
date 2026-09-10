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
    backend_base_url: str = "http://localhost:8000"

    @property
    def fb_oauth_redirect_uri(self) -> str:
        return f"{self.backend_base_url}/api/social/facebook/callback"    
    
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



settings = Settings()
