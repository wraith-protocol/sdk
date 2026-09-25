import { base58Encode } from './utils';

export {
  seedToScalar,
  bytesToScalar,
  scalarToBytes,
  hashToScalar,
  signWithScalar,
  deriveStealthPubKey,
  L,
} from '../stellar/scalar';

/**
 * Converts a 32-byte ed25519 public key to a base58-encoded Solana address.
 */
export function pubKeyToSolanaAddress(pubKeyBytes: Uint8Array): string {
  return base58Encode(pubKeyBytes);
}
