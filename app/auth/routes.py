from urllib.parse import urlencode

import jwt
from flask import current_app, jsonify, redirect, request, session

from app.auth import auth_bp
from app.core.dominex_client import fetch_user_projection, has_biographia_access
from app.extensions import db
from app.models import SsoTicketUse


def _sso_redirect_url(next_path=""):
    if not next_path.startswith("/"):
        next_path = ""

    authorize_url = (
        f"{current_app.config['SSOD_AUTH_PUBLIC_URL'].rstrip('/')}"
        f"/account/sso/authorize/biographia/"
    )
    if next_path:
        authorize_url += f"?{urlencode({'next': next_path})}"
    return authorize_url


@auth_bp.get("/auth/sso/redirect")
def sso_redirect():
    """Entry point for "Войти" once a real UI exists - sends the browser
    to ssod_auth's ticket-issuing endpoint, same shape as Dominex's own
    auth.sso_redirect (dominex/app/auth/routes.py)."""
    return redirect(_sso_redirect_url(request.args.get("next") or ""))


@auth_bp.get("/logout")
def logout():
    session.clear()
    return jsonify({"ok": True, "message": "Сессия завершена."})


@auth_bp.get("/auth/ssod-site")
def ssod_site_link():
    """"На сайт SSOD.pro" on the logged-out screen - Biographia is one
    module among several, this is how someone who ended up here without
    wanting Biographia specifically finds their way back to the rest of
    the ecosystem."""
    return redirect(current_app.config["SSOD_SITE_URL"])


@auth_bp.get("/auth/ssod-account")
def ssod_account_link():
    """"Личный кабинет ССОД" - same idea as ssod_site_link() above, but
    to ssod_auth's own account/product-switcher page rather than the
    public site."""
    return redirect(f"{current_app.config['SSOD_AUTH_PUBLIC_URL'].rstrip('/')}/account/")


@auth_bp.get("/auth/sso/callback")
def sso_callback():
    """Accepts a short-lived SSO ticket issued by ssod_auth
    (accounts/views.py::sso_authorize there), verifies it statelessly
    (signature + exp + aud="biographia" - no callback to ssod_auth
    needed), enforces single use via SsoTicketUse, then - unlike Dominex,
    which has a local User table - resolves identity by asking Dominex's
    own projection API (Biographia owns no identity data of its own, see
    TZ section 2/6.1) and double-checks an active biographia grant there
    even though ssod_auth already gated ticket issuance on the same
    thing (defense in depth against a stale ssod_auth-side cache).
    No templates yet (pre-SPA) - JSON error responses, redirect on
    success."""
    ticket = request.args.get("ticket", "")
    next_path = request.args.get("next") or ""

    try:
        payload = jwt.decode(
            ticket,
            current_app.config["SSO_TICKET_SECRET"],
            algorithms=["HS256"],
            audience="biographia",
        )
    except jwt.PyJWTError as exc:
        return jsonify({"ok": False, "error": f"invalid_ticket: {exc}"}), 401

    jti = payload.get("jti")
    if not jti or db.session.get(SsoTicketUse, jti) is not None:
        return jsonify({"ok": False, "error": "ticket_already_used"}), 401

    # Mark used immediately - closes the replay race window regardless of
    # what happens below (same reasoning as Dominex's sso_callback).
    db.session.add(SsoTicketUse(jti=jti))
    db.session.commit()

    username = payload.get("sub")
    projection = fetch_user_projection(username)
    if projection is None:
        return jsonify({"ok": False, "error": f"dominex_unreachable_or_unknown_user: {username}"}), 502

    if not has_biographia_access(projection):
        return jsonify({"ok": False, "error": f"no_active_biographia_grant: {username}"}), 403

    session["username"] = projection["username"]
    session["display_name"] = projection["display_name"]
    session["access_class"] = projection["access_class"]
    session["organization"] = projection.get("organization")
    # Needed for the org-zone "admin group" visibility check
    # (app/records/routes.py::can_view_record) - reuses Dominex's own
    # Role semantics (superadmin/admin/user), not a Biographia-specific
    # concept.
    session["role"] = projection.get("role")

    if not next_path.startswith("/"):
        next_path = "/"  # SPA home (app/main.py's index route is API-only now)
    return redirect(next_path)
