from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 1440

    database_url: str = "sqlite:///./campusmind.db"

    ai_provider: str = "mock"
    ai_model_name: str = "gemini-3.5-flash"
    gemini_api_key: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    embedding_provider: str = "local"
    embedding_model_name: str = "gemini-embedding-2"

    frontend_origin: str = "http://localhost:5173"

    max_upload_mb: int = 25
    upload_dir: str = "./uploads"

    # --- Cloudinary (profile image uploads) ---
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    max_avatar_mb: int = 5


settings = Settings()
