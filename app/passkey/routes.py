"""WebAuthn ceremony endpoints for the PRF key provider (TZ section 4:
"провайдер ключа — подключаемый... есть FIDO2-токен → ключ устройства
выводится из токена (WebAuthn PRF)").

Important split of responsibility: this module (and the `webauthn`
Python library it uses) only proves *possession* of a registered
credential - the standard attestation/assertion signature verification
every WebAuthn login flow does. It never sees, computes, or verifies the
PRF secret itself - PRF evaluation happens entirely in the browser via
the `prf` extension on the same `navigator.credentials.create()/get()`
call, and only the browser ever holds the resulting bytes. That's why
`generate_registration_options()`/`generate_authentication_options()`
below don't need any PRF-specific arguments - the Python library has no
concept of PRF at all, the frontend adds that extension request on top
of the JSON these endpoints return.
"""

import json

import webauthn
from flask import current_app, jsonify, request, session
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import PublicKeyCredentialDescriptor

from app.core import ssod_auth_client
from app.core.auth import require_session
from app.core.ssod_auth_client import SsodAuthUnavailable
from app.passkey import passkey_bp


@passkey_bp.get("/webauthn/register/options")
def register_options():
    """Step 1 of registering a new token/passkey for personal-zone unlock
    - not a login credential, a *second*, independent registration even
    if it's the same physical key ssod_auth's own django_otp_webauthn
    already trusts for signing in (see app/passkey docstring)."""
    viewer = require_session()

    options = webauthn.generate_registration_options(
        rp_id=current_app.config["WEBAUTHN_RP_ID"],
        rp_name=current_app.config["WEBAUTHN_RP_NAME"],
        user_name=viewer["username"],
        user_display_name=viewer.get("display_name") or viewer["username"],
    )
    # Server-side, short-lived, tied to this browser session - not
    # persisted anywhere durable, just enough to survive the round trip
    # to the authenticator and back for verification below.
    session["webauthn_challenge"] = bytes_to_base64url(options.challenge)

    payload = json.loads(webauthn.options_to_json(options))
    # The Python library has no PRF concept (see module docstring) -
    # added by hand here so the browser knows to request it.
    payload["extensions"] = {"prf": {}}
    return jsonify(payload)


@passkey_bp.post("/webauthn/register/verify")
def register_verify():
    """Step 2 - verifies the attestation the browser produced, then
    stores only the public key + sign counter in ssod_auth's registry
    (TZ section 4's "реестр... не хранилище рабочего секрета" applies
    here exactly as it does to PersonalKeyMaterial)."""
    viewer = require_session()
    data = request.get_json(silent=True) or {}

    challenge_b64url = session.pop("webauthn_challenge", None)
    if not challenge_b64url:
        return jsonify({"ok": False, "error": "no_pending_challenge"}), 400

    try:
        verification = webauthn.verify_registration_response(
            credential=data.get("credential"),
            expected_challenge=base64url_to_bytes(challenge_b64url),
            expected_rp_id=current_app.config["WEBAUTHN_RP_ID"],
            expected_origin=current_app.config["WEBAUTHN_ORIGIN"],
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": f"verification_failed: {exc}"}), 400

    # A credential without PRF support is useless for this feature's
    # purpose specifically - reject visibly rather than silently storing
    # a credential the unlock flow can never actually use.
    prf_enabled = bool((data.get("clientExtensionResults") or {}).get("prf", {}).get("enabled"))
    if not prf_enabled:
        return jsonify({"ok": False, "error": "authenticator_does_not_support_prf"}), 400

    credential_id = bytes_to_base64url(verification.credential_id)
    public_key = bytes_to_base64url(verification.credential_public_key)
    label = (data.get("label") or "").strip() or "Без названия"

    try:
        ssod_auth_client.store_webauthn_credential(
            viewer["username"],
            credential_id,
            public_key,
            sign_count=verification.sign_count,
            transports=data.get("transports") or [],
            label=label,
        )
    except SsodAuthUnavailable as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502

    return jsonify({"ok": True, "credential_id": credential_id}), 201


@passkey_bp.get("/webauthn/authenticate/options")
def authenticate_options():
    """Unlike registration, this needs the user's already-registered
    credential list (to build allowCredentials) - fetched from the
    registry, not guessed. Still requires an existing Biographia session
    (SSO already happened) - this ceremony only ever proves "same token
    that was registered", it's not a login/identity mechanism itself."""
    viewer = require_session()

    try:
        credentials = ssod_auth_client.fetch_webauthn_credentials(viewer["username"])
    except SsodAuthUnavailable as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502

    if not credentials:
        return jsonify({"ok": False, "error": "no_credentials_registered"}), 404

    allow_credentials = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"]), transports=c.get("transports") or None)
        for c in credentials
    ]
    options = webauthn.generate_authentication_options(
        rp_id=current_app.config["WEBAUTHN_RP_ID"],
        allow_credentials=allow_credentials,
    )
    session["webauthn_challenge"] = bytes_to_base64url(options.challenge)

    payload = json.loads(webauthn.options_to_json(options))
    # Fixed salt: the same input must be reused on every unlock so the
    # authenticator/platform derives the same PRF output each time -
    # a random salt per attempt would make the wrapped master key
    # unrecoverable after the very first unlock.
    payload["extensions"] = {"prf": {"eval": {"first": bytes_to_base64url(b"biographia-personal-zone-v1")}}}
    return jsonify(payload)


@passkey_bp.post("/webauthn/authenticate/verify")
def authenticate_verify():
    """Verifies the assertion, updates the clone-detection sign counter,
    and hands back which credential this was - the browser already has
    the PRF output from the same ceremony and uses it to fetch/unwrap
    that specific credential's wrapped master key via /crypto/material."""
    viewer = require_session()
    data = request.get_json(silent=True) or {}

    challenge_b64url = session.pop("webauthn_challenge", None)
    if not challenge_b64url:
        return jsonify({"ok": False, "error": "no_pending_challenge"}), 400

    credential_id = data.get("credential_id") or ""
    try:
        credentials = ssod_auth_client.fetch_webauthn_credentials(viewer["username"])
    except SsodAuthUnavailable as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502

    stored = next((c for c in credentials if c["credential_id"] == credential_id), None)
    if stored is None:
        return jsonify({"ok": False, "error": "unknown_credential"}), 404

    try:
        verification = webauthn.verify_authentication_response(
            credential=data.get("credential"),
            expected_challenge=base64url_to_bytes(challenge_b64url),
            expected_rp_id=current_app.config["WEBAUTHN_RP_ID"],
            expected_origin=current_app.config["WEBAUTHN_ORIGIN"],
            credential_public_key=base64url_to_bytes(stored["public_key"]),
            credential_current_sign_count=stored["sign_count"],
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": f"verification_failed: {exc}"}), 400

    try:
        ssod_auth_client.update_webauthn_sign_count(credential_id, verification.new_sign_count)
    except SsodAuthUnavailable:
        pass  # best-effort bookkeeping - a missed sign-count bump doesn't invalidate this successful unlock

    return jsonify({"ok": True, "credential_id": credential_id})
