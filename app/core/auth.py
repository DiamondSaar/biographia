from flask import abort, request, session

from app.extensions import db
from app.models.device_session import DeviceSession, hash_token
from app.models.integrations import utcnow


def _device_session_from_bearer_token():
    """Returns a viewer dict if the request carries a valid
    `Authorization: Bearer <token>` header, else None (meaning: fall
    back to the cookie session instead). A malformed/expired/revoked
    token is treated the same as "no token" here on purpose - the
    header-absent and header-invalid cases both just mean "try cookie
    auth next"; require_session() is what actually 401s if NEITHER
    method works."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None

    raw_token = header[len("Bearer ") :].strip()
    if not raw_token:
        return None

    device_session = DeviceSession.query.filter_by(token_hash=hash_token(raw_token)).first()
    if device_session is None or not device_session.is_active():
        return None

    device_session.last_used_at = utcnow()
    db.session.commit()
    return device_session.to_viewer_dict()


def require_session():
    """The single entry point every route in app/records/routes.py calls
    to find out "who's asking". Two ways in, same shape out:

    1. Mobile app: Authorization: Bearer <device token> header
       (see POST /auth/mobile/login in app/auth/routes.py, and
       DeviceSession in app/models/device_session.py).
    2. Web SPA: Flask's cookie session, set once at SSO login
       (app/auth/routes.py::sso_callback).

    Either way this returns something usable as viewer["username"],
    viewer.get("organization"), etc. - callers never need an if/else for
    "which kind of caller is this". Flask's `session` object already
    behaves like a dict for that purpose; a DeviceSession is turned into
    a plain dict with the same keys (to_viewer_dict()) so the two are
    interchangeable from the caller's point of view.
    """
    device_viewer = _device_session_from_bearer_token()
    if device_viewer is not None:
        return device_viewer

    if "username" not in session:
        abort(401)
    return session
