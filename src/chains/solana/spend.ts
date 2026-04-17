import { signWithScalar } from '../stellar/scalar';

export { deriveStealthPrivateScalar } from '../stellar/spend';

/**
 * Signs a Solana transaction hash using the stealth private scalar.
 *
 * Implements ed25519 signing directly with the derived scalar,
 * which may not be clamped and thus cannot be used with standard
 * Keypair-based signing.
 *
 * @param transactionHash  The 32-byte hash of the Solana transaction message.
 * @param stealthScalar    The stealth private scalar.
 * @param stealthPubKey    The 32-byte stealth public key.
 * @returns 64-byte ed25519 signature.
 */
export function signSolanaTransaction(
  transactionHash: Uint8Array,
  stealthScalar: bigint,
  stealthPubKey: Uint8Array,
): Uint8Array {
  return signWithScalar(transactionHash, stealthScalar, stealthPubKey);
}
