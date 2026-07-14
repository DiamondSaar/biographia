from flask import Blueprint

crypto_bp = Blueprint("crypto", __name__)

from app.crypto import routes  # noqa: E402,F401
