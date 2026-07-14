"""Personal-zone key registry client (TZ section 4) - the one place
Biographia calls *into* ssod_auth server-to-server, own secret
(BIOGRAPHIA_KEY_API_KEY), own direction. Never sees/handles plaintext
key material itself, only relays the already-encrypted blob the browser
computed - this module could log every byte it touches and still leak
nothing useful. Same for WebAuthn credentials: public key + sign count
only, the PRF secret never leaves the authenticator/browser."""

import requests
from flask import current_app


class SsodAuthUnavailable(Exception):
    """Distinct from "not set up yet" (a real empty list/404) - a network
    failure or unexpected status must not be read by callers as "nothing
    registered", or a temporary ssod_auth outage would look like the
    user needs to redo setup from scratch."""


PERSONAL_KEY_FIELDS = (
    "wrapped_master_key",
    "nonce",
    "kdf_algorithm",
    "kdf_salt",
    "kdf_memory_kib",
    "kdf_iterations",
    "kdf_parallelism",
)


def _base_url():
    return current_app.config["SSOD_AUTH_INTERNAL_URL"].rstrip("/")


def _headers():
    return {"X-Biographia-Key-Api-Key": current_app.config["BIOGRAPHIA_KEY_API_KEY"]}


def _post(path, payload):
    try:
        response = requests.post(f"{_base_url()}{path}", json=payload, headers=_headers(), timeout=5)
    except requests.RequestException as exc:
        # Deliberately not best-effort like dominex_client's reads - a
        # silently-failed write would tell the user their data is
        # protected/registered when it never left their browser durably.
        raise SsodAuthUnavailable(str(exc)) from exc
    if response.status_code not in (200, 201):
        raise SsodAuthUnavailable(f"ssod_auth returned {response.status_code}: {response.text[:200]}")
    return response.json()


def _get(path):
    try:
        response = requests.get(f"{_base_url()}{path}", headers=_headers(), timeout=5)
    except requests.RequestException as exc:
        raise SsodAuthUnavailable(str(exc)) from exc
    if response.status_code != 200:
        raise SsodAuthUnavailable(f"ssod_auth returned {response.status_code}: {response.text[:200]}")
    return response.json()


def store_personal_key_material(username, material, provider="password", credential_id=None, label=None):
    payload = {
        "username": username,
        "provider": provider,
        **{field: material[field] for field in PERSONAL_KEY_FIELDS},
    }
    if credential_id:
        payload["credential_id"] = credential_id
    if label:
        payload["label"] = label
    return _post("/api/v1/personal-key/", payload)


def fetch_personal_key_materials(username):
    """Every registered wrapped copy (password + any WebAuthn tokens) -
    empty list is a normal, valid "nothing set up yet" state, not an
    error (unlike SsodAuthUnavailable, which is for when the registry
    itself couldn't be reached)."""
    return _get(f"/api/v1/personal-key/{username}/")["materials"]


def store_webauthn_credential(username, credential_id, public_key, sign_count=0, transports=None, label=None):
    return _post(
        "/api/v1/webauthn-credentials/",
        {
            "username": username,
            "credential_id": credential_id,
            "public_key": public_key,
            "sign_count": sign_count,
            "transports": transports or [],
            "label": label or "",
        },
    )


def fetch_webauthn_credentials(username):
    return _get(f"/api/v1/webauthn-credentials/{username}/")["credentials"]


def update_webauthn_sign_count(credential_id, sign_count):
    return _post(f"/api/v1/webauthn-credentials/{credential_id}/sign-count/", {"sign_count": sign_count})
