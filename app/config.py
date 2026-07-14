import os

from dotenv import load_dotenv


load_dotenv()


class Config:
    """Base app settings loaded from environment variables - mirrors dominex/app/config.py's style."""

    SECRET_KEY = os.getenv("SECRET_KEY", "dev-change-me")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://biographia:biographia@localhost:5432/biographia",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Dominex identity API - Biographia is one row in IdentityApiConsumer
    # (biographia TZ section 2.2), not sharing ssod_auth's key.
    DOMINEX_API_BASE_URL = os.getenv("DOMINEX_API_BASE_URL", "http://dominex_app:5000")
    DOMINEX_API_KEY = os.getenv("DOMINEX_API_KEY", "")

    # SSO ticket handoff (TZ section 2.1) - see app/auth/routes.py.
    SSO_TICKET_SECRET = os.getenv("SSO_TICKET_SECRET", "dev-sso-ticket-secret-change-me")
    SSOD_AUTH_PUBLIC_URL = os.getenv("SSOD_AUTH_PUBLIC_URL", "http://127.0.0.1:8010")

    # Personal-zone key registry (TZ section 4) - server-to-server calls to
    # ssod_auth, a new direction (Biographia -> ssod_auth, not the usual
    # other way). Internal URL uses the hyphenated alias
    # "ssod-auth-internal" - the plain service name "ssod_auth_web" can
    # never work as a Host header (Django rejects underscores outright,
    # see biographia TZ section 13). Own secret, matches
    # BIOGRAPHIA_KEY_API_KEY in ssod_auth/app/config/settings.py.
    SSOD_AUTH_INTERNAL_URL = os.getenv("SSOD_AUTH_INTERNAL_URL", "http://ssod-auth-internal:8000")
    BIOGRAPHIA_KEY_API_KEY = os.getenv("BIOGRAPHIA_KEY_API_KEY", "dev-biographia-key-api-change-me")

    # Object storage for attachments (TZ section 9) - MinIO locally, any
    # S3-compatible endpoint in production.
    MINIO_ENDPOINT_URL = os.getenv("MINIO_ENDPOINT_URL", "http://biographia-minio-internal:9000")
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "")
    MINIO_BUCKET = os.getenv("MINIO_BUCKET", "biographia-attachments")

    # WebAuthn PRF provider (TZ section 4, pluggable key provider) - RP ID
    # must exactly match the browser's hostname (not scheme/port), and
    # ORIGIN must match exactly including scheme+port. "127.0.0.1" is NOT
    # interchangeable with "localhost" for WebAuthn - browsers only grant
    # the secure-context exception to the literal hostname "localhost",
    # so local testing must go through http://localhost:5173, not
    # http://127.0.0.1:5173, even though both work for everything else
    # in this app.
    WEBAUTHN_RP_ID = os.getenv("WEBAUTHN_RP_ID", "localhost")
    WEBAUTHN_RP_NAME = os.getenv("WEBAUTHN_RP_NAME", "Biographia")
    WEBAUTHN_ORIGIN = os.getenv("WEBAUTHN_ORIGIN", "http://localhost:5173")
