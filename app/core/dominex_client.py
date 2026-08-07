"""Reads Dominex's identity projection - mirrors ssod_auth's own
accounts/services/dominex_client.py (same idea: best-effort read, own
per-service key from IdentityApiConsumer, never raises on failure so a
Dominex outage degrades rather than crashes)."""

import requests
from flask import current_app


def fetch_user_projection(username):
    base_url = current_app.config["DOMINEX_API_BASE_URL"].rstrip("/")
    api_key = current_app.config["DOMINEX_API_KEY"]

    try:
        response = requests.get(
            f"{base_url}/api/v1/identity/projection/users/{username}",
            headers={"X-Dominex-Api-Key": api_key},
            timeout=5,
        )
    except requests.RequestException:
        return None

    if response.status_code != 200:
        return None

    return response.json()


def verify_credentials(username, password):
    """Checks a username/password pair against Dominex - the sole store
    of ecosystem login credentials (see Dominex's own
    app/api/identity.py::verify_credentials docstring). Biographia never
    stores or checks a password itself; this is the same
    server-to-server call ssod_auth already makes for its own login form.
    Used by POST /auth/mobile/login (app/auth/routes.py) - the mobile
    app has no browser to run the SSO redirect through, so it needs a
    direct way to prove identity instead.

    Returns True/False, never raises - a Dominex outage should surface as
    "login failed", not a 500."""
    base_url = current_app.config["DOMINEX_API_BASE_URL"].rstrip("/")
    api_key = current_app.config["DOMINEX_API_KEY"]

    try:
        response = requests.post(
            f"{base_url}/api/v1/identity/credentials/verify",
            json={"username": username, "password": password},
            headers={"X-Dominex-Api-Key": api_key},
            timeout=5,
        )
    except requests.RequestException:
        return False

    if response.status_code != 200:
        return False

    return bool(response.json().get("valid"))


def has_biographia_access(projection):
    if projection is None:
        return False
    return any(
        product.get("code") == "biographia" and product.get("status") == "active"
        for product in projection.get("products", [])
    )


def _get(path, params=None):
    base_url = current_app.config["DOMINEX_API_BASE_URL"].rstrip("/")
    api_key = current_app.config["DOMINEX_API_KEY"]
    try:
        response = requests.get(
            f"{base_url}{path}",
            params=params,
            headers={"X-Dominex-Api-Key": api_key},
            timeout=5,
        )
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    return response.json()


def evaluate_oracle(username, intermediate, client_ip=None):
    """Relays a locally-derived KDF intermediate to Dominex's crypto
    oracle and returns its structured result - unlike _get() above, the
    caller needs to tell apart rate_limited/inactive/unknown_user from a
    generic outage to show the right message, so this doesn't collapse
    every failure into None."""
    base_url = current_app.config["DOMINEX_API_BASE_URL"].rstrip("/")
    api_key = current_app.config["DOMINEX_API_KEY"]
    try:
        response = requests.post(
            f"{base_url}/api/v1/oracle/evaluate",
            json={"username": username, "intermediate": intermediate, "client_ip": client_ip},
            headers={"X-Dominex-Api-Key": api_key},
            timeout=5,
        )
    except requests.RequestException:
        return {"ok": False, "error": "oracle_unavailable"}

    try:
        payload = response.json()
    except ValueError:
        return {"ok": False, "error": "oracle_unavailable"}

    if response.status_code == 200 and payload.get("ok"):
        return {"ok": True, "result": payload["result"]}

    return {"ok": False, "error": payload.get("error", "oracle_unavailable")}


def fetch_entity(entity_id):
    return _get(f"/api/v1/entities/{entity_id}")


def fetch_organization(organization_id):
    return _get(f"/api/v1/organizations/{organization_id}")


def search(q, parents_only=False, limit=20):
    result = _get("/api/v1/entities/search", params={"q": q, "parents_only": str(parents_only).lower(), "limit": limit})
    return result or {"results": []}


def search_users(q, limit=20):
    """"Владелец/Ответственный" picker (records/routes.py::reassign_owner,
    the frontend's UserPicker) - only a real Dominex User (ecosystem
    participant with a login) can be an owner, so this is a separate
    search from search() above, which returns entities/organizations."""
    result = _get("/api/v1/identity/users/search", params={"q": q, "limit": limit})
    return result or {"results": []}
