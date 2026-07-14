from flask import Blueprint

passkey_bp = Blueprint("passkey", __name__)

from app.passkey import routes  # noqa: E402,F401
