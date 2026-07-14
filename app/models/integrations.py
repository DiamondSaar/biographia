from datetime import datetime, timezone

from app.extensions import db


def utcnow():
    return datetime.now(timezone.utc)


class SsoTicketUse(db.Model):
    """Replay guard for SSO tickets issued by ssod_auth and consumed at
    /auth/sso/callback - mirrors dominex/app/models/integrations.py's
    SsoTicketUse exactly (same pattern, same reasoning: verification
    itself is stateless JWT signature+exp+aud, this table's only job is
    making sure a given ticket jti can be redeemed once)."""

    __tablename__ = "sso_ticket_uses"

    jti = db.Column(db.String(36), primary_key=True)
    used_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    def __repr__(self):
        return f"<SsoTicketUse jti={self.jti}>"
