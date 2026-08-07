from flask import Flask
from flask_cors import CORS

from app.config import Config
from app.extensions import db, migrate
from app.main import main_bp


def create_app(config_object=Config):
    """Create and configure the Biographia Flask application."""
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    migrate.init_app(app, db)

    # See Config.CORS_ALLOWED_ORIGINS's own comment - only
    # biographia-mobile's web preview target needs this at all, and it's
    # deliberately not credentialed (no cookies cross-origin), since that
    # client authenticates with a Bearer token instead.
    CORS(app, origins=app.config["CORS_ALLOWED_ORIGINS"], supports_credentials=False)

    from app import models  # noqa: F401 - registers tables on db.metadata for Flask-Migrate

    from app.auth import auth_bp
    from app.crypto import crypto_bp
    from app.passkey import passkey_bp
    from app.records import records_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(records_bp)
    app.register_blueprint(crypto_bp)
    app.register_blueprint(passkey_bp)

    return app
