import requests
from flask import Blueprint, current_app, jsonify

from app.core.auth import require_session
from app.core.dominex_client import fetch_user_projection

main_bp = Blueprint("main", __name__)


@main_bp.get("/")
def index():
    return jsonify({"service": "biographia", "status": "ok"})


@main_bp.get("/whoami")
def whoami():
    """Proves a session actually persists and carries real identity -
    works for both the web SPA (cookie, established by
    /auth/sso/callback) and the mobile app (Bearer device token,
    established by /auth/mobile/login) via require_session(), see
    app/core/auth.py. Used by biographia-mobile on app start to restore
    "who's logged in" from a token that survived a previous session
    (see src/context/AuthContext.tsx there)."""
    viewer = require_session()
    return jsonify(
        {
            "authenticated": True,
            "username": viewer["username"],
            "display_name": viewer["display_name"],
            "access_class": viewer["access_class"],
            "organization": viewer.get("organization"),
            "role": viewer.get("role"),
        }
    )


@main_bp.get("/profile")
def profile():
    """Fresh profile card for ЛК автора (TZ 7.3: "ФИО, должность и т. д. —
    из Dominex"). Not named /me - that's the frontend's own SPA route
    (Layout.jsx sidebar), and Vite's dev-server proxy path-matches on
    prefixes, so the two names would collide (a page refresh on /me
    would hit this JSON endpoint instead of the SPA). Unlike /whoami's
    session snapshot, this re-fetches from Dominex on every call -
    position isn't stored in the session at all (never needed there),
    and org/access_class could have drifted since login. A round-trip
    per page load, not per request across the app - acceptable for a
    profile page that isn't hit on every navigation."""
    viewer = require_session()
    projection = fetch_user_projection(viewer["username"])
    if projection is None:
        return jsonify({"ok": False, "error": "dominex_unreachable"}), 502
    return jsonify(projection)


@main_bp.get("/health")
def health():
    return jsonify({"status": "ok"})


@main_bp.get("/debug/dominex-check")
def dominex_check():
    """Temporary connectivity smoke-test - proves the docker network path
    and the biographia IdentityApiConsumer key actually work end to end
    (biographia TZ section 2.2/13). Remove once a real console screen
    exercises the same call path."""
    base_url = current_app.config["DOMINEX_API_BASE_URL"].rstrip("/")
    api_key = current_app.config["DOMINEX_API_KEY"]
    if not api_key:
        return jsonify({"ok": False, "error": "DOMINEX_API_KEY not set"}), 500

    try:
        response = requests.get(
            f"{base_url}/api/v1/identity/projection/users/admin",
            headers={"X-Dominex-Api-Key": api_key},
            timeout=5,
        )
    except requests.RequestException as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502

    return jsonify(
        {
            "ok": response.status_code == 200,
            "dominex_status": response.status_code,
            "dominex_body": response.json() if response.status_code == 200 else response.text[:200],
        }
    )
