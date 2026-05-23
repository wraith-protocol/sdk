import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import type { StealthKeys } from './types';
import { seedToScalar } from './scalar';

/**
 * Derives Stellar stealth spending and viewing keys from a wallet signature.
 *
 * Use this with a 64-byte ed25519 signature of {@link STEALTH_SIGNING_MESSAGE}.
 * The result is deterministic for the same wallet and signature message, so
 * keep the returned seeds and scalars private.
 *
 * @param signature - 64-byte ed25519 signature produced by the user's Stellar wallet.
 * @returns Spending and viewing seeds, scalars, and public keys for Stellar stealth payments.
 * @throws {Error} If `signature` is not exactly 64 bytes.
 *
 * @example
 * ```ts
 * import { Keypair } from "@stellar/stellar-sdk";
 * import { deriveStealthKeys, STEALTH_SIGNING_MESSAGE } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const keypair = Keypair.random();
 * const signature = keypair.sign(Buffer.from(STEALTH_SIGNING_MESSAGE));
 * const keys = deriveStealthKeys(signature);
 *
 * console.log(keys.spendingPubKey, keys.viewingPubKey);
 * ```
 *
 * @see {@link encodeStealthMetaAddress} to publish the public keys for senders.
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
