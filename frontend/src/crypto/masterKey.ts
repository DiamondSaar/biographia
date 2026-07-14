// Personal-zone master key handling (biographia TZ section 4). Everything
// here runs client-side only - the server (Biographia backend, ssod_auth
// registry) never sees a password, seed phrase, or plaintext key, only
// the outputs of wrapMasterKey() (ciphertext + public KDF params).
//
// Standing requirement from the TZ itself: before real sensitive content
// is trusted to this scheme, it needs a professional crypto review - this
// is a first working slice (password + seed phrase only, no WebAuthn PRF
// yet), not a claim that it's already been audited.

import { argon2id } from "@noble/hashes/argon2";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

export interface KdfParams {
  memoryKib: number;
  iterations: number;
  parallelism: number;
}

// Now defense-in-depth only (in case the crypto oracle - see
// wrapMasterKeyWithOracle below - is ever bypassed or down), not the
// primary defense against offline brute force: that job moved to
// Dominex's rate-limited HMAC oracle. Old kdf_algorithm === "argon2id"
// rows (pre-oracle) don't use this constant at all - they keep using
// their own stored per-row kdf_memory_kib/iterations/parallelism, so
// lightening this cannot break anything already wrapped.
export const DEFAULT_KDF_PARAMS: KdfParams = { memoryKib: 12288, iterations: 2, parallelism: 1 };

export interface WrappedKeyMaterial {
  wrapped_master_key: string;
  nonce: string;
  kdf_algorithm: "argon2id" | "argon2id+oracle";
  kdf_salt: string;
  kdf_memory_kib: number;
  kdf_iterations: number;
  kdf_parallelism: number;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Shared AEAD wrap/unwrap given an already-derived 32-byte wrapping key -
// the password path derives this via Argon2id (see wrapMasterKey/
// unwrapMasterKey below), the WebAuthn PRF path derives it via HKDF over
// the authenticator's PRF output (see webauthn.ts). Both end up calling
// these two functions so there's exactly one AEAD implementation to
// review, not two copies that could silently drift.
export function wrapMasterKeyWithKey(masterKey: Uint8Array, wrappingKey: Uint8Array): { ciphertext: string; nonce: string } {
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(wrappingKey, nonce).encrypt(masterKey);
  return { ciphertext: bytesToBase64(ciphertext), nonce: bytesToBase64(nonce) };
}

export function unwrapMasterKeyWithKey(wrappingKey: Uint8Array, ciphertext: string, nonce: string): Uint8Array {
  return xchacha20poly1305(wrappingKey, base64ToBytes(nonce)).decrypt(base64ToBytes(ciphertext));
}

export function generateSeedPhrase(): string {
  return generateMnemonic(wordlist, 128); // 12 words
}

export function isValidSeedPhrase(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim(), wordlist);
}

// The seed phrase IS the ultimate source of the master key (like a crypto
// wallet) - deterministic, so recovery never needs server-stored state:
// re-entering the same 12 words always regenerates the exact same key.
export function masterKeyFromSeedPhrase(mnemonic: string): Uint8Array {
  const seed = mnemonicToSeedSync(mnemonic.trim());
  return hkdf(sha256, seed, undefined, "biographia-master-key", 32);
}

// Argon2id output - the final wrapping key on the legacy (no-oracle)
// path below, but just an intermediate value on the oracle path (see
// combineIntermediateWithOracleResult) - not reversible to the password,
// but also not yet safe against unlimited offline guessing on its own,
// which is exactly why the oracle path exists.
export function deriveIntermediate(password: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  return argon2id(password, salt, {
    m: params.memoryKib,
    t: params.iterations,
    p: params.parallelism,
    dkLen: 32,
  });
}

// Legacy (pre-oracle) path - Argon2id output used directly as the
// wrapping key. Kept only so rows already wrapped this way
// (kdf_algorithm === "argon2id") keep unwrapping correctly; every new
// wrap goes through wrapMasterKeyWithOracle below instead.
export function wrapMasterKey(
  masterKey: Uint8Array,
  password: string,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS,
): WrappedKeyMaterial {
  const salt = randomBytes(16);
  const wrappingKey = deriveIntermediate(password, salt, kdfParams);
  const { ciphertext, nonce } = wrapMasterKeyWithKey(masterKey, wrappingKey);

  return {
    wrapped_master_key: ciphertext,
    nonce,
    kdf_algorithm: "argon2id",
    kdf_salt: bytesToBase64(salt),
    kdf_memory_kib: kdfParams.memoryKib,
    kdf_iterations: kdfParams.iterations,
    kdf_parallelism: kdfParams.parallelism,
  };
}

// Throws (doesn't return null) on a wrong password - AEAD authentication
// failure is exactly the signal a wrong password produces, no separate
// verification step needed.
export function unwrapMasterKey(password: string, material: WrappedKeyMaterial): Uint8Array {
  const salt = base64ToBytes(material.kdf_salt);
  const wrappingKey = deriveIntermediate(password, salt, {
    memoryKib: material.kdf_memory_kib,
    iterations: material.kdf_iterations,
    parallelism: material.kdf_parallelism,
  });
  return unwrapMasterKeyWithKey(wrappingKey, material.wrapped_master_key, material.nonce);
}

// Combines the local KDF output with the Dominex oracle's HMAC result
// into the actual wrapping key - oracleResult (secret-dependent, only
// knowable by asking Dominex) as IKM, intermediate (locally-derivable,
// "public" relative to the oracle's own secret) as HKDF salt.
export function combineIntermediateWithOracleResult(intermediate: Uint8Array, oracleResult: Uint8Array): Uint8Array {
  return hkdf(sha256, oracleResult, intermediate, "biographia-oracle-wrap-v1", 32);
}

// Resolves to a base64 oracle result, or throws/rejects on failure
// (rate-limited, inactive, unavailable, ...) - see api.js's cryptoOracle().
export type OracleCall = (intermediateB64: string) => Promise<string>;

// Oracle-hardened wrap - the new default path for any fresh password
// setup or recovery. Same shape as wrapMasterKey above, but the
// wrapping key additionally depends on Dominex's per-user secret, so
// offline brute force of the resulting blob alone is no longer enough -
// see biographia_tz.md's crypto-oracle section.
export async function wrapMasterKeyWithOracle(
  masterKey: Uint8Array,
  password: string,
  oracleCall: OracleCall,
  kdfParams: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<WrappedKeyMaterial> {
  const salt = randomBytes(16);
  const intermediate = deriveIntermediate(password, salt, kdfParams);
  const oracleResultB64 = await oracleCall(bytesToBase64(intermediate));
  const wrappingKey = combineIntermediateWithOracleResult(intermediate, base64ToBytes(oracleResultB64));
  const { ciphertext, nonce } = wrapMasterKeyWithKey(masterKey, wrappingKey);

  return {
    wrapped_master_key: ciphertext,
    nonce,
    kdf_algorithm: "argon2id+oracle",
    kdf_salt: bytesToBase64(salt),
    kdf_memory_kib: kdfParams.memoryKib,
    kdf_iterations: kdfParams.iterations,
    kdf_parallelism: kdfParams.parallelism,
  };
}

// Unwrap counterpart - used when material.kdf_algorithm === "argon2id+oracle".
export async function unwrapMasterKeyWithOracle(
  password: string,
  material: WrappedKeyMaterial,
  oracleCall: OracleCall,
): Promise<Uint8Array> {
  const salt = base64ToBytes(material.kdf_salt);
  const intermediate = deriveIntermediate(password, salt, {
    memoryKib: material.kdf_memory_kib,
    iterations: material.kdf_iterations,
    parallelism: material.kdf_parallelism,
  });
  const oracleResultB64 = await oracleCall(bytesToBase64(intermediate));
  const wrappingKey = combineIntermediateWithOracleResult(intermediate, base64ToBytes(oracleResultB64));
  return unwrapMasterKeyWithKey(wrappingKey, material.wrapped_master_key, material.nonce);
}

// Per-service subkey (TZ 4: "один ключ на все сервисы - как ощущение;
// под капотом... подключи с меткой сервиса"). Biographia's own personal
// data is encrypted with this, never the raw master key directly.
export function deriveSubkey(masterKey: Uint8Array, label = "biographia"): Uint8Array {
  return hkdf(sha256, masterKey, undefined, label, 32);
}

export function encryptText(subkey: Uint8Array, plaintext: string): { ciphertext: string; nonce: string } {
  const nonce = randomBytes(24);
  const bytes = new TextEncoder().encode(plaintext);
  const ciphertext = xchacha20poly1305(subkey, nonce).encrypt(bytes);
  return { ciphertext: bytesToBase64(ciphertext), nonce: bytesToBase64(nonce) };
}

export function decryptText(subkey: Uint8Array, ciphertext: string, nonce: string): string {
  const decrypted = xchacha20poly1305(subkey, base64ToBytes(nonce)).decrypt(base64ToBytes(ciphertext));
  return new TextDecoder().decode(decrypted);
}
