import { computeSharedSecret } from "./stealth";
import {
  hashToScalar,
  signWithScalar,
  L,
} from "./scalar";

/**
 * Derives the stealth private scalar that controls a stealth address.
 *
 * Recipient-side logic (matches EVM: p_stealth = (m + s_h) mod n):
 *   1. S = ECDH(viewing_key, R_ephemeral)
 *   2. hash_scalar = SHA-256("wraith:scalar:" || S) mod L
 *   3. stealth_scalar = (spending_scalar + hash_scalar) mod L
 *
 * Requires the spending SCALAR (private key), not just the public key.
 * The viewing key alone cannot derive this — it can only detect matches.
 *
 * @param spendingScalar  Recipient's spending private scalar.
 * @param viewingKey      Recipient's 32-byte viewing seed (for ECDH).
 * @param ephemeralPubKey The 32-byte ephemeral public key from the announcement.
 * @returns The stealth private scalar.
 */
export function deriveStealthPrivateScalar(
  spendingScalar: bigint,
  viewingKey: Uint8Array,
  ephemeralPubKey: Uint8Array
): bigint {
  const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);
  const hScalar = hashToScalar(sharedSecret);
  return (spendingScalar + hScalar) % L;
}

/**
 * Signs a Stellar transaction hash using the stealth private scalar.
 *
 * This implements ed25519 signing directly with the derived scalar,
 * bypassing Keypair.fromRawEd25519Seed() which cannot produce a
 * keypair for a non-clamped derived scalar.
 *
 * @param transactionHash  The 32-byte SHA-256 hash of the Stellar transaction envelope.
 * @param stealthScalar    The stealth private scalar.
 * @param stealthPubKey    The 32-byte stealth public key.
 * @returns 64-byte ed25519 signature.
 */
export function signStellarTransaction(
  transactionHash: Uint8Array,
  stealthScalar: bigint,
  stealthPubKey: Uint8Array
): Uint8Array {
  return signWithScalar(transactionHash, stealthScalar, stealthPubKey);
}
