// WebAuthn PRF unlock provider (biographia TZ section 4 - pluggable key
// provider). This module owns the browser-side ceremony + PRF handling;
// app/passkey/routes.py owns the server-verifiable signature/attestation
// half. The two are deliberately separate concerns - see that module's
// docstring for why the Python `webauthn` library never sees PRF at all.

import {
  base64URLStringToBuffer,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { api } from "../api.js";
import { unwrapMasterKeyWithKey, wrapMasterKeyWithKey } from "./masterKey.ts";

// The TS DOM lib bundled with @simplewebauthn/browser predates the PRF
// extension (see AuthenticationExtensionsClientOutputs in its dom.d.ts -
// no `prf` field), even though real browsers implement it - hence the
// casts to this local shape wherever we read clientExtensionResults.prf.
interface PrfExtensionOutputs {
  prf?: {
    enabled?: boolean;
    results?: { first?: ArrayBuffer; second?: ArrayBuffer };
  };
}

// Fixed HKDF label, not a secret - just domain-separates this derivation
// from deriveSubkey() in masterKey.ts so the same PRF output can never
// accidentally collide with an unrelated use of HKDF elsewhere.
function deriveWrappingKeyFromPrf(prfOutput: ArrayBuffer): Uint8Array {
  return hkdf(sha256, new Uint8Array(prfOutput), undefined, "biographia-webauthn-wrap", 32);
}

// Step 1 of adding a new hardware key/passkey as an unlock method for an
// already-unlocked personal zone. Throws `authenticator_does_not_support_prf`
// if the chosen authenticator can't do PRF - registering it anyway would
// create a key the unlock flow could never actually use.
export async function registerWebAuthnKey(
  masterKey: Uint8Array,
  label: string,
): Promise<{ credentialId: string }> {
  const optionsJSON = await api.webauthnRegisterOptions();

  const registrationResponse = await startRegistration({ optionsJSON });

  const prfOutputs = registrationResponse.clientExtensionResults as PrfExtensionOutputs;
  if (!prfOutputs.prf?.enabled) {
    throw new Error("authenticator_does_not_support_prf");
  }

  await api.webauthnRegisterVerify({
    credential: registrationResponse,
    clientExtensionResults: registrationResponse.clientExtensionResults,
    label,
    transports: registrationResponse.response.transports || [],
  });

  // The credential now exists in the registry, but has no wrapped master
  // key yet - do a first PRF evaluation (same shape as unlockWithWebAuthnKey,
  // just with eval.first supplied up front since we already know the
  // credential id) and store the wrapped copy immediately, so registering
  // a key is a one-step "add this as an unlock method" action from the
  // caller's point of view.
  const credentialId = registrationResponse.id;
  const prfOutput = await evaluatePrf(credentialId);
  const wrappingKey = deriveWrappingKeyFromPrf(prfOutput);
  const { ciphertext, nonce } = wrapMasterKeyWithKey(masterKey, wrappingKey);

  await api.cryptoSetup({
    provider: "webauthn_prf",
    credential_id: credentialId,
    label,
    wrapped_master_key: ciphertext,
    nonce,
    kdf_algorithm: "none",
    kdf_salt: "",
    kdf_memory_kib: 0,
    kdf_iterations: 0,
    kdf_parallelism: 0,
  });

  return { credentialId };
}

// Runs an authentication ceremony against one specific already-registered
// credential purely to get a fresh PRF output from it - used both right
// after registration (to wrap the master key for the first time) and,
// via unlockWithWebAuthnKey, on every later unlock.
async function evaluatePrf(credentialId: string): Promise<ArrayBuffer> {
  const optionsJSON = await api.webauthnAuthenticateOptions();
  const saltB64url = optionsJSON.extensions?.prf?.eval?.first;

  // The browser's native WebAuthn API requires a raw BufferSource for
  // prf.eval.first - the backend sends it base64url-encoded (like every
  // other field in this JSON), and @simplewebauthn/browser passes
  // `extensions` through unconverted (it has no built-in PRF support -
  // see PrfExtensionOutputs above), so this has to be decoded by hand
  // before it reaches startAuthentication().
  optionsJSON.extensions = {
    ...(optionsJSON.extensions || {}),
    prf: { eval: { first: base64URLStringToBuffer(saltB64url) } },
  };
  optionsJSON.allowCredentials = (optionsJSON.allowCredentials || []).filter(
    (c) => c.id === credentialId,
  );

  const authResponse = await startAuthentication({ optionsJSON });

  // Proves this is a genuine assertion from the registered authenticator
  // (signature + sign-counter check) - independent of the PRF output
  // below, and worth doing even though the AEAD tag on the wrapped key
  // would itself reject a wrong PRF output; skipping it would mean this
  // flow never actually exercises the ceremony verification it was built
  // for. api.js's request() already throws on the non-2xx this returns
  // on failure, so no separate ok-check is needed here.
  await api.webauthnAuthenticateVerify({ credential_id: authResponse.id, credential: authResponse });

  const prfOutputs = authResponse.clientExtensionResults as PrfExtensionOutputs;
  const prfOutput = prfOutputs.prf?.results?.first;
  if (!prfOutput) {
    throw new Error("prf_not_available");
  }
  return prfOutput;
}

// Unlock path: fetches this credential's wrapped master key from the
// registry and unwraps it locally with a PRF-derived key - the server
// never sees the PRF output or the resulting wrapping key, only the
// already-encrypted blob it was already storing.
export async function unlockWithWebAuthnKey(credentialId: string): Promise<Uint8Array> {
  const prfOutput = await evaluatePrf(credentialId);
  const wrappingKey = deriveWrappingKeyFromPrf(prfOutput);
  const material = await api.cryptoMaterial("webauthn_prf", credentialId);
  return unwrapMasterKeyWithKey(wrappingKey, material.wrapped_master_key, material.nonce);
}
