import { ed25519 } from '@noble/curves/ed25519';
import { computeSharedSecret, computeViewTag } from '../stellar/stealth';
import { hashToScalar, deriveStealthPubKey } from '../stellar/scalar';
import { pubKeyToSolanaAddress } from './scalar';
import type { GeneratedStealthAddress } from './types';

export { computeSharedSecret, computeViewTag };

/**
 * Generates a one-time stealth address for a recipient on Solana.
 *
 * Uses ed25519 point addition (same DKSAP as Stellar/EVM):
 *   - ECDH: shared_secret = X25519(ephemeral, V_recipient)
 *   - hash_scalar = SHA-256("wraith:scalar:" || shared_secret) mod L
 *   - view_tag = SHA-256("wraith:tag:" || shared_secret)[0]
 *   - P_stealth = K_spend + hash_scalar * G
 *   - stealth_address = base58(P_stealth)
 *
 * @param spendingPubKey  Recipient's 32-byte ed25519 spending public key.
 * @param viewingPubKey   Recipient's 32-byte ed25519 viewing public key.
 * @param ephemeralSeed   Optional 32-byte seed for deterministic testing.
 */
export function generateStealthAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
  ephemeralSeed?: Uint8Array,
): GeneratedStealthAddress {
  const ephSeed = ephemeralSeed ?? ed25519.utils.randomPrivateKey();
  const ephPubKey = ed25519.getPublicKey(ephSeed);

  const sharedSecret = computeSharedSecret(ephSeed, viewingPubKey);
  const viewTag = computeViewTag(sharedSecret);
  const hScalar = hashToScalar(sharedSecret);
  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
  const stealthAddress = pubKeyToSolanaAddress(stealthPubKeyBytes);

  return {
    stealthAddress,
    ephemeralPubKey: ephPubKey,
    viewTag,
  };
}
