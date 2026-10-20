import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    internal_secret: str
    csrf_secret: str
    origins: tuple[str, ...]
    public_url: str
    secure_cookies: bool
    environment: str


def settings():
    internal = os.environ.get("INTERNAL_API_SECRET", "")
    csrf = os.environ.get("CSRF_SECRET", "")
    if len(internal) < 32 or len(csrf) < 32:
        raise RuntimeError("INTERNAL_API_SECRET and CSRF_SECRET must each contain at least 32 characters")
    public_url = os.environ.get("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
    return Settings(
        os.environ["DATABASE_URL"], internal, csrf,
        tuple(value.strip() for value in os.environ.get("ORIGIN", public_url).split(",") if value.strip()),
        public_url, public_url.startswith("https://"), os.environ.get("APP_ENV", "production"),
    )
