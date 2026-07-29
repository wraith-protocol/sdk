import { InvalidSignatureError } from '../../errors';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import type { StealthKeys } from './types';
import { seedToScalar } from './scalar';
import { STEALTH_SIGNING_MESSAGE } from './constants';
import type { StellarStealthSigner } from './signer';

/**
 * Derives Stellar stealth spending and viewing keys from a wallet signature.
 *
 * Use this with a 64-byte ed25519 signature of {@link STEALTH_SIGNING_MESSAGE}.
 * The result is deterministic for the same wallet and signature message, so
 * keep the returned seeds and scalars private.
 *
 * Each seed is then expanded via SHA-512 and clamped to produce
 * the actual ed25519 scalar (matching how standard ed25519 derives
 * the private scalar from a seed).
 *
 * @throws {InvalidSignatureError} If signature length is not 64.
 */
export function deriveStealthKeys(signature: Uint8Array): StealthKeys {
  if (signature.length !== 64) {
    throw new InvalidSignatureError(signature, 64, signature.length);
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

/**
 * Derives Stellar stealth keys using any {@link StellarStealthSigner}.
 *
 * This is the signer-based entry point: it asks `signer` to sign
 * {@link STEALTH_SIGNING_MESSAGE} and feeds the resulting bytes into
 * {@link deriveStealthKeys}. Existing callers that already hold a raw 64-byte
 * Freighter signature can keep calling `deriveStealthKeys` directly; this
 * wrapper exists for signers (e.g. passkeys) whose signing step isn't a
 * simple synchronous ed25519 signature.
 *
 * @throws {InvalidSignatureError} If the signer does not return 64 bytes.
 *
 * @see {@link deriveStealthKeys}
 * @see {@link StellarStealthSigner}
 */
export async function deriveStealthKeysFromSigner(
  signer: StellarStealthSigner,
): Promise<StealthKeys> {
  const message = new TextEncoder().encode(STEALTH_SIGNING_MESSAGE);
  const signature = await signer.signMessage(message);
  return deriveStealthKeys(signature);
}
