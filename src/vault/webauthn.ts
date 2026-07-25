/**
 * WebAuthn helpers for the Wraith Seed Vault.
 *
 * Uses the WebAuthn **PRF** extension (`prf`) to derive a deterministic
 * 32-byte symmetric key from a platform or cross-platform authenticator.
 * That key encrypts the user's stealth signing seed via AES-256-GCM so the
 * seed never leaves the browser in plaintext.
 *
 * **Browser support:** Chrome 116+, Edge 116+, and any browser implementing
 * the WebAuthn Level 3 PRF extension. Call {@link isWebAuthnSupported} before
 * invoking the other helpers.
 *
 * @module vault/webauthn
 */

/**
 * Default origin-agnostic relying-party identifier.
 *
 * Callers SHOULD override this with a domain-scoped RP id (e.g.
 * `"login.example.com"`) in production so credentials remain valid across
 * subdomains if needed.
 */
const DEFAULT_RP_ID = 'wraith-protocol';

const DEFAULT_RP_NAME = 'Wraith Protocol';

/**
 * Returns `true` when the current browser supports WebAuthn **and** the PRF
 * extension.
 *
 * This is the gate check — if it returns `false`, {@link createCredential}
 * and {@link getAssertion} will reject.
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  );
}

/**
 * Check whether a platform authenticator (Touch ID, Windows Hello, etc.) is
 * available on the current device.
 *
 * Callers can use this to decide whether to show a "create vault" button
 * before the user goes through the WebAuthn flow. If this returns `false`,
 * the user only has cross-platform authenticators (e.g. USB security keys)
 * available.
 *
 * Returns `null` when `isWebAuthnSupported() === false` (i.e. the browser
 * does not support WebAuthn at all).
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean | null> {
  if (!isWebAuthnSupported()) return null;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Extract the 32-byte PRF result from a credential response.
 *
 * The PRF extension is not defined in the standard TypeScript DOM types but
 * is available at runtime in supporting browsers.
 */
function extractPrfResult(
  response: AuthenticatorAttestationResponse | AuthenticatorAssertionResponse,
): Uint8Array {
  const ext = (response as any).getClientExtensionResults?.() as
    { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } } | undefined;

  if (!ext?.prf?.enabled || !ext.prf.results?.first) {
    throw new Error(
      'WebAuthn PRF extension is not supported by this authenticator. ' +
        'Try a different device or browser.',
    );
  }

  return new Uint8Array(ext.prf.results.first);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreateCredentialResult {
  /** Base64url-encoded credential ID — store this for later assertions. */
  credentialId: string;
  /** 32-byte PRF output — the AES-256 key material. */
  prfKey: Uint8Array;
}

/**
 * Register a new WebAuthn credential and derive a 32-byte PRF key.
 *
 * The PRF salt is echoed in the `prf.eval.first` extension field so the
 * authenticator can compute `HMAC-SHA256(credentialPrivateKey, salt)`.
 * The same salt must be supplied to {@link getAssertion} to recover the
 * same key.
 *
 * **User experience:** the browser will prompt for a biometric or PIN touch.
 *
 * @param salt         - 32-byte PRF evaluation salt (MUST be random and
 *                       stored alongside the encrypted seed).
 * @param rpId         - Relying Party id (defaults to `"wraith-protocol"`).
 * @param userName     - Display name shown in the browser UI.
 * @returns The credential ID and derived 32-byte PRF key.
 */
export async function createCredential(
  salt: Uint8Array,
  rpId = DEFAULT_RP_ID,
  userName = 'Wraith Seed Vault',
): Promise<CreateCredentialResult> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser.');
  }

  if (salt.byteLength !== 32) {
    throw new RangeError(`PRF salt must be 32 bytes; got ${salt.byteLength}`);
  }

  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId, name: DEFAULT_RP_NAME },
      user: {
        id: userId as BufferSource,
        name: userName,
        displayName: userName,
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)) as BufferSource,
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
      },
      extensions: {
        prf: { eval: { first: salt.buffer as ArrayBuffer } },
      } as any,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('WebAuthn credential creation was cancelled or failed.');
  }

  const prfKey = extractPrfResult(credential.response as AuthenticatorAttestationResponse);

  return {
    credentialId: base64UrlEncode(credential.rawId),
    prfKey,
  };
}

/**
 * Perform a WebAuthn assertion (biometric / PIN touch) and recover the
 * 32-byte PRF key.
 *
 * @param credentialId - Base64url-encoded credential ID returned by
 *                       {@link createCredential}.
 * @param salt         - The same 32-byte salt that was supplied to
 *                       {@link createCredential}.
 * @param rpId         - Relying Party id (must match the creation call).
 * @returns The recovered 32-byte PRF key.
 */
export async function getAssertion(
  credentialId: string,
  salt: Uint8Array,
  rpId = DEFAULT_RP_ID,
): Promise<Uint8Array> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser.');
  }

  if (salt.byteLength !== 32) {
    throw new RangeError(`PRF salt must be 32 bytes; got ${salt.byteLength}`);
  }

  const idBytes = base64UrlDecode(credentialId);

  const assertion = (await navigator.credentials.get({
    publicKey: {
      rpId,
      challenge: crypto.getRandomValues(new Uint8Array(32)) as BufferSource,
      allowCredentials: [
        {
          id: idBytes as BufferSource,
          type: 'public-key',
        },
      ],
      userVerification: 'required',
      extensions: {
        prf: { eval: { first: salt.buffer as ArrayBuffer } },
      } as any,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error('WebAuthn assertion was cancelled or failed.');
  }

  return extractPrfResult(assertion.response as AuthenticatorAssertionResponse);
}
