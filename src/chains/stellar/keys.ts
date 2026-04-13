import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import type { StealthKeys } from './types';
import { seedToScalar } from './scalar';

/**
 * Derives stealth spending and viewing keys from a wallet signature.
 *
 * The 64-byte ed25519 signature is domain-separated and hashed
 * to produce two independent ed25519 seeds:
 *   - spendingKey = SHA-256("wraith:spending:" || signature)
 *   - viewingKey  = SHA-256("wraith:viewing:" || signature)
 *
 * Each seed is then expanded via SHA-512 and clamped to produce
 * the actual ed25519 scalar (matching how standard ed25519 derives
 * the private scalar from a seed).
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
