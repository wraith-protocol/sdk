import { sha256 } from '@noble/hashes/sha256';
import { KeyDerivationFailedError } from '../../errors';

/**
 * Minimal signing capability required to derive Stellar stealth keys.
 *
 * Implementations may wrap any wallet or signer shape (Freighter, a WebAuthn
 * passkey, a smart-account session key) as long as `signMessage` returns bytes
 * that are stable for a given wallet/message pair across separate calls,
 * including across sessions and devices for the same underlying wallet.
 * {@link deriveStealthKeysFromSigner} feeds the returned bytes into the same
 * domain-separated SHA-256 derivation used by {@link deriveStealthKeys}, so any
 * signer that satisfies this contract is interchangeable.
 *
 * @see {@link deriveStealthKeysFromSigner}
 * @see {@link FreighterStealthSigner}
 * @see {@link WebAuthnPasskeyStealthSigner}
 */
export interface StellarStealthSigner {
  /**
   * Returns 64 deterministic bytes for `message`.
   *
   * The bytes do not need to be a raw ed25519 signature: {@link deriveStealthKeys}
   * only requires exactly 64 bytes that are reproducible for the same signer
   * and message.
   */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/** Freighter-shaped wallet API accepted by {@link FreighterStealthSigner}. */
export interface FreighterLikeWallet {
  signMessage(message: string): Promise<{ signedMessage: Uint8Array | string }>;
}

/**
 * Wraps a Freighter-shaped ed25519 wallet as a {@link StellarStealthSigner}.
 *
 * This is the existing derivation path: it signs the message with the
 * wallet's ed25519 key and passes the raw 64-byte signature straight through,
 * unchanged from calling `deriveStealthKeys` with a Freighter signature
 * directly.
 *
 * @see {@link StellarStealthSigner}
 */
export class FreighterStealthSigner implements StellarStealthSigner {
  constructor(private readonly wallet: FreighterLikeWallet) {}

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const { signedMessage } = await this.wallet.signMessage(new TextDecoder().decode(message));
    return typeof signedMessage === 'string' ? base64ToBytes(signedMessage) : signedMessage;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** WebAuthn assertion shape needed to extract PRF extension output. */
export interface WebAuthnPRFAssertion {
  getClientExtensionResults(): {
    prf?: {
      results?: {
        first?: ArrayBuffer;
        second?: ArrayBuffer;
      };
    };
  };
}

/** Minimal shape of `navigator.credentials` needed to request a WebAuthn assertion. */
export interface WebAuthnCredentialsContainer {
  get(options: Record<string, unknown>): Promise<WebAuthnPRFAssertion | null>;
}

/** Options for {@link WebAuthnPasskeyStealthSigner}. */
export interface WebAuthnPasskeyStealthSignerOptions {
  /** Credential ID of the passkey to request an assertion for. */
  credentialId: Uint8Array;
  /**
   * `navigator.credentials` or a compatible implementation (e.g. a test mock,
   * or a smart-account SDK's WebAuthn shim). Defaults to the global
   * `navigator.credentials` when running in a browser.
   */
  credentials?: WebAuthnCredentialsContainer;
  /** Relying party ID passed through to `navigator.credentials.get()`. */
  rpId?: string;
}

/**
 * Reference passkey adapter for deriving Stellar stealth keys from a WebAuthn
 * (secp256r1 smart-account) signer.
 *
 * WebAuthn `get()` assertions are not deterministic across sessions: ECDSA
 * signing uses a fresh nonce and the authenticator's signature counter and
 * `clientDataJSON` challenge change on every call. Hashing the raw assertion
 * signature the way the Freighter path hashes a raw ed25519 signature would
 * therefore derive a different stealth key every time.
 *
 * Instead this adapter requests the WebAuthn Level 3 `prf` extension, whose
 * output is deterministically derived from the credential's private key
 * material and a fixed salt, independent of the assertion signature. Two
 * salts are evaluated so the combined output is 64 bytes, matching what
 * {@link deriveStealthKeys} expects.
 *
 * This adapter only covers stealth-key derivation. Authorizing the on-chain
 * smart-account operation that funds or spends a stealth address is a
 * separate WebAuthn `get()` call (without the `prf` extension) whose
 * assertion is submitted to the smart-account contract; it does not need to
 * be deterministic.
 *
 * @see {@link StellarStealthSigner}
 */
export class WebAuthnPasskeyStealthSigner implements StellarStealthSigner {
  private readonly credentialId: Uint8Array;
  private readonly credentials: WebAuthnCredentialsContainer;
  private readonly rpId?: string;

  constructor(options: WebAuthnPasskeyStealthSignerOptions) {
    this.credentialId = options.credentialId;
    this.rpId = options.rpId;

    const globalCredentials = (globalThis as { navigator?: { credentials?: unknown } }).navigator
      ?.credentials as WebAuthnCredentialsContainer | undefined;
    const credentials = options.credentials ?? globalCredentials;
    if (!credentials) {
      throw new KeyDerivationFailedError(
        'No WebAuthn credentials container available; pass `credentials` explicitly outside a browser context.',
      );
    }
    this.credentials = credentials;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const first = derivePRFSalt(message, 'first');
    const second = derivePRFSalt(message, 'second');

    const assertion = await this.credentials.get({
      publicKey: {
        challenge: message,
        rpId: this.rpId,
        allowCredentials: [{ id: this.credentialId, type: 'public-key' }],
        userVerification: 'required',
        extensions: {
          prf: { eval: { first, second } },
        },
      },
    });

    const results = assertion?.getClientExtensionResults().prf?.results;
    if (!results?.first || !results?.second) {
      throw new KeyDerivationFailedError(
        'Authenticator did not return PRF extension results; a PRF-capable passkey is required for deterministic stealth key derivation.',
      );
    }

    const combined = new Uint8Array(64);
    combined.set(new Uint8Array(results.first).subarray(0, 32), 0);
    combined.set(new Uint8Array(results.second).subarray(0, 32), 32);
    return combined;
  }
}

function derivePRFSalt(message: Uint8Array, label: 'first' | 'second'): Uint8Array {
  const prefix = new TextEncoder().encode(`wraith:stellar:passkey-prf:${label}:`);
  const input = new Uint8Array(prefix.length + message.length);
  input.set(prefix);
  input.set(message, prefix.length);
  return sha256(input);
}
