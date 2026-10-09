import logging

from pydantic_settings import BaseSettings, SettingsConfigDict


# The built-in key exists so local development and the test suite work with no
# setup. It is public (it is in the repository), so it must never sign tokens
# in production; see validate_production_settings().
DEFAULT_SECRET_KEY = "dev-secret-change-me"
# Placeholders copied from docs and .env.example that nobody should deploy with.
UNSAFE_SECRET_KEYS = {
    DEFAULT_SECRET_KEY,
    "change-this-to-a-long-random-string",
    "your-secret-key",
    "secret",
    "changeme",
}
MIN_PRODUCTION_SECRET_LENGTH = 32


class ConfigurationError(RuntimeError):
    """The app is configured in a way that is unsafe to run."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    secret_key: str = DEFAULT_SECRET_KEY
    access_token_expire_minutes: int = 1440

    database_url: str = "sqlite:///./campusmind.db"

    ai_provider: str = "mock"
    ai_model_name: str = "gemini-3.5-flash"
    gemini_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    embedding_provider: str = "local"
    embedding_model_name: str = "gemini-embedding-2"

    # One origin, or several separated by commas (e.g. production + a Vercel preview).
    frontend_origin: str = "http://localhost:5173"

    max_upload_mb: int = 25
    upload_dir: str = "./uploads"

    # --- Cloudinary (profile image uploads) ---
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    max_avatar_mb: int = 5

    # Shared secret for the external scheduler that calls
    # POST /api/notifications/process-reminders. Empty disables that path
    # (admins can still trigger it from their own session).
    cron_secret: str = ""

    # --- Web Push (VAPID) ---
    # The public key is handed to browsers (via GET /api/push/status); the
    # private key is backend-only and must never reach the frontend.
    # Push is disabled, not broken, until all three are set.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    # A contact URI the push services can use, e.g. mailto:admin@your-college.edu
    vapid_subject: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]



def validate_production_settings(cfg: "Settings") -> None:
    """Refuses to start in production with a missing or well-known SECRET_KEY,
    because anyone could then forge login tokens. Other environments
    (development, test) are left alone. The message never includes the value."""
    if cfg.environment.strip().lower() != "production":
        return
    key = cfg.secret_key.strip()
    if not key or key in UNSAFE_SECRET_KEYS:
        raise ConfigurationError(
            "SECRET_KEY is missing or still a development placeholder. Set SECRET_KEY to a long random "
            "value in the production environment (generate one with: "
            'python -c "import secrets; print(secrets.token_urlsafe(48))").'
        )
    if len(key) < MIN_PRODUCTION_SECRET_LENGTH:
        raise ConfigurationError(
            f"SECRET_KEY is too short for production (at least {MIN_PRODUCTION_SECRET_LENGTH} characters). "
            "Generate a longer one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )


def offline_fallbacks(cfg: "Settings") -> list[str]:
    """Names the AI features that would silently run in offline demo mode
    because their provider has no API key. Only the names are returned."""
    out = []
    keys = {"gemini": cfg.gemini_api_key, "openai": cfg.openai_api_key, "claude": cfg.anthropic_api_key}
    if cfg.ai_provider.lower() in keys and not keys[cfg.ai_provider.lower()].strip():
        out.append("answers")
    if cfg.embedding_provider.lower() in ("gemini", "openai") and not keys[cfg.embedding_provider.lower()].strip():
        out.append("embeddings")
    return out


settings = Settings()
validate_production_settings(settings)
if settings.environment.strip().lower() == "production" and offline_fallbacks(settings):
    logging.getLogger("campusmind").warning(
        "Production is running with offline demo %s: the configured AI provider has no API key.",
        " and ".join(offline_fallbacks(settings)),
    )
