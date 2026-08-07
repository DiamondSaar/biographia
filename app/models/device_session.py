import hashlib
import secrets

from app.extensions import db
from app.models.integrations import utcnow


def generate_device_token():
    """Returns (raw_token, token_hash). The raw token is shown to the
    client exactly once (at login) and never stored anywhere - only its
    SHA-256 hash lives in the database. Same "secret stored only as a
    fingerprint" pattern ssod_auth already uses for SSODAccessKey: if the
    database ever leaks, the leaked hashes are useless for logging in as
    someone, since SHA-256 isn't reversible.

    secrets.token_urlsafe (not random/uuid) because it's specifically
    designed for exactly this - cryptographically strong, safe to put in
    a URL or Authorization header without escaping.
    """
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return raw_token, token_hash


def hash_token(raw_token):
    """Same hashing the token was created with - used to look up an
    incoming Authorization: Bearer <token> header against the stored
    hash, without ever storing or comparing the raw token itself."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


class DeviceSession(db.Model):
    """A mobile app's logged-in session - the token-based counterpart to
    the browser's cookie session (see app/auth/routes.py's SSO callback,
    which sets Flask's `session` dict). A phone has no browser in the
    normal sense, so it can't carry a cookie the way the web SPA does;
    instead it logs in once (POST /auth/mobile/login) and gets back a
    long-lived opaque token, which it then sends as
    `Authorization: Bearer <token>` on every request.

    The identity fields below (username/display_name/access_class/
    organization/role) are a **snapshot taken at login time** - the same
    set of fields the SSO callback puts into the cookie session. They can
    go stale if the person's org/access_class changes in Dominex later;
    that's an accepted tradeoff for now (the cookie session has the exact
    same staleness - it's also just a snapshot from login time, not
    re-checked on every request). Refreshing this on each use, or
    expiring sessions after N days, is a reasonable future improvement,
    not built here.

    Design note - this is deliberately the SAME mechanism the project's
    own TZ document already describes for a future native mobile client
    (biographia_tz.md sec. 4.1, "Biographia выпускает собственный
    device-токен"), just without that document's QR-code pairing ceremony
    (its "Step 1") in front of it. A user typing their password once
    accomplishes the same thing - getting a device token - just with a
    plainer login screen instead of a QR scan. The QR flow can be added
    later as a nicer way to *obtain* a token; it wouldn't change how
    tokens are stored or checked here at all.
    """

    __tablename__ = "device_sessions"

    id = db.Column(db.Integer, primary_key=True)
    token_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)

    # Identity snapshot - same shape as the cookie session dict, so
    # app/core/auth.py can hand back a plain dict that looks identical to
    # callers regardless of which auth method was used.
    username = db.Column(db.String(150), nullable=False, index=True)
    display_name = db.Column(db.String(255), nullable=True)
    access_class = db.Column(db.String(1), nullable=True)
    organization = db.Column(db.JSON, nullable=True)
    role = db.Column(db.String(50), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    last_used_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    def is_active(self):
        return self.revoked_at is None

    def to_viewer_dict(self):
        """Matches exactly what app/core/auth.py's require_session()
        already returns for a cookie session (the Flask `session` object,
        used like a dict everywhere in app/records/routes.py) - so route
        handlers never need to know or care whether the caller came in
        over a browser cookie or a mobile Bearer token."""
        return {
            "username": self.username,
            "display_name": self.display_name,
            "access_class": self.access_class,
            "organization": self.organization,
            "role": self.role,
        }

    def __repr__(self):
        return f"<DeviceSession username={self.username}>"
