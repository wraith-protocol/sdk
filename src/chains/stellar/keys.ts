import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import type { StealthKeys } from './types';
import { seedToScalar } from './scalar';

/**
 * Derives the stealth spending and viewing key pairs from a 64-byte ed25519 wallet signature.
 *
 * Apply this to the raw signature bytes produced when the user signs
 * {@link STEALTH_SIGNING_MESSAGE} with their Stellar wallet. The derivation is
 * deterministic: signing the same message twice with the same wallet always produces
 * the same keys. The two keys are domain-separated so they are cryptographically
 * independent:
 *
 * ```
 * spendingKey = SHA-256("wraith:spending:" || signature)
 * viewingKey  = SHA-256("wraith:viewing:"  || signature)
 * ```
 *
 * Each 32-byte seed is then expanded via SHA-512 and clamped (standard ed25519 scalar
 * derivation) to produce the corresponding private scalar.
 *
 * **Security note:** Treat `spendingKey` and `spendingScalar` as private key material —
 * they can authorise spending. The viewing key is less sensitive (it can detect incoming
 * payments but cannot spend), but should still be kept private to preserve payment privacy.
 *
 * @param signature - Raw 64-byte ed25519 signature returned by the wallet. Must not be
 *   hex-encoded — pass the raw `Uint8Array`.
 * @returns An object containing the spending and viewing seeds, scalars, and public keys.
 * @throws {Error} If `signature` is not exactly 64 bytes.
 *
 * @example
 * ```ts
 * import { STEALTH_SIGNING_MESSAGE, deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
 *
 * // Ask the wallet to sign the canonical message
 * const signatureBytes = await wallet.signMessage(STEALTH_SIGNING_MESSAGE);
 *
 * const { spendingKey, viewingKey, spendingPubKey, viewingPubKey } =
 *   deriveStealthKeys(signatureBytes);
 * ```
 *
 * @see {@link encodeStealthMetaAddress} to turn the public keys into a shareable meta-address
 * @see {@link STEALTH_SIGNING_MESSAGE} for the exact message to sign
 */
export function deriveStealthKeys(signature: Uint8Array): StealthKeys {
  if (signature.length !== 64) {
    throw new Error(`Expected 64-byte ed25519 signature, got ${signature.length} bytes`);
  }

  const spendingPrefix = new TextEncoder().encode('wraith:spending:');
  const viewingPrefix = new TextEncoder().encode('wraith:viewing:');

  const spendingInput = new Uint8Array(spendingPrefix.length + signature.length);
  spendingInput.set(spendingPrefix);
  spendingInput.set(signature, spendingPrefix.length);

  const viewingInput = new Uint8Array(viewingPrefix.length + signature.length);
  viewingInput.set(viewingPrefix);
  viewingInput.set(signature, viewingPrefix.length);

  const spendingKey = sha256(spendingInput);
  const viewingKey = sha256(viewingInput);

  const spendingScalar = seedToScalar(spendingKey);
  const viewingScalar = seedToScalar(viewingKey);

  const spendingPubKey = ed25519.getPublicKey(spendingKey);
  const viewingPubKey = ed25519.getPublicKey(viewingKey);

  return {
    spendingKey,
    spendingScalar,
    viewingKey,
    viewingScalar,
    spendingPubKey,
    viewingPubKey,
  };
}