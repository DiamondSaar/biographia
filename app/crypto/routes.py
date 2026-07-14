from flask import jsonify, request

from app.core import dominex_client, ssod_auth_client
from app.core.auth import require_session
from app.core.ssod_auth_client import SsodAuthUnavailable
from app.crypto import crypto_bp

REQUIRED_SETUP_FIELDS = (
    "wrapped_master_key",
    "nonce",
    "kdf_algorithm",
    "kdf_salt",
    "kdf_memory_kib",
    "kdf_iterations",
    "kdf_parallelism",
)


@crypto_bp.get("/crypto/status")
def crypto_status():
    """Lets the SPA decide "show setup" vs "show unlock" (and which
    unlock options to offer - password, a registered token, or both)
    without ever touching the actual wrapped blobs (TZ section 4 - the
    registry is a broker, browser code should only fetch the real
    material right before it's about to unwrap it, not speculatively)."""
    viewer = require_session()
    try:
        materials = ssod_auth_client.fetch_personal_key_materials(viewer["username"])
    except SsodAuthUnavailable as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502
    return jsonify(
        {
            "configured": len(materials) > 0,
            "providers": [{"provider": m["provider"], "credential_id": m["credential_id"], "label": m["label"]} for m in materials],
        }
    )


@crypto_bp.post("/crypto/setup")
def crypto_setup():
    """Relays an already-encrypted blob computed in the browser to the
    ssod_auth registry (TZ section 4). This endpoint never sees a
    password, seed phrase, PRF secret, or plaintext master key - only
    ciphertext + public parameters, by construction of what the client
    sends. `provider` selects which wrapped copy this is (default
    "password" - backward compatible with the pre-WebAuthn setup flow);
    "webauthn_prf" additionally requires `credential_id` naming an
    already-registered credential (see /webauthn/register/verify)."""
    viewer = require_session()
    data = request.get_json(silent=True) or {}

    missing = [f for f in REQUIRED_SETUP_FIELDS if f not in data]
    if missing:
        return jsonify({"ok": False, "error": "missing_fields", "fields": missing}), 400

    provider = data.get("provider") or "password"
    if provider == "webauthn_prf" and not data.get("credential_id"):
        return jsonify({"ok": False, "error": "credential_id_required_for_webauthn_prf"}), 400

    try:
        ssod_auth_client.store_personal_key_material(
            viewer["username"],
            data,
            provider=provider,
            credential_id=data.get("credential_id"),
            label=data.get("label"),
        )
    except SsodAuthUnavailable as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502

    return jsonify({"ok": True}), 201


@crypto_bp.get("/crypto/material")
def crypto_material():
    """Fetch side - browser calls this once per unlock attempt, then does
    the Argon2id/PRF + AEAD unwrap entirely locally. `?provider=` picks
    which wrapped copy (default "password"); for webauthn_prf, also pass
    `?credential_id=` to disambiguate between multiple registered
    tokens."""
    viewer = require_session()
    provider = request.args.get("provider") or "password"
    credential_id = request.args.get("credential_id")

    try:
        materials = ssod_auth_client.fetch_personal_key_materials(viewer["username"])
    except SsodAuthUnavailable as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502

    for material in materials:
        if material["provider"] != provider:
            continue
        if provider == "webauthn_prf" and material["credential_id"] != credential_id:
            continue
        return jsonify(material)

    return jsonify({"ok": False, "error": "not_set_up"}), 404


@crypto_bp.post("/crypto/oracle")
def crypto_oracle():
    """Relays the browser's locally-computed KDF intermediate to
    Dominex's crypto oracle (turns offline-unlimited password brute
    force into online-rate-limited, see Dominex's app/api/oracle.py) and
    returns its result verbatim. Never logs or persists `intermediate`
    itself - it only ever exists in this function's local variables."""
    viewer = require_session()
    data = request.get_json(silent=True) or {}
    intermediate = data.get("intermediate")
    if not intermediate:
        return jsonify({"ok": False, "error": "missing_intermediate"}), 400

    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    result = dominex_client.evaluate_oracle(viewer["username"], intermediate, client_ip)

    if result["ok"]:
        return jsonify({"ok": True, "result": result["result"]})

    status_by_error = {"rate_limited": 429, "inactive": 403, "unknown_user": 404}
    return jsonify({"ok": False, "error": result["error"]}), status_by_error.get(result["error"], 502)
