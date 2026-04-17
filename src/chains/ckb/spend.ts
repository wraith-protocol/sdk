import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { toHex, toBytes } from 'viem';
import type { HexString } from './types';

/**
 * Derives the private key that controls a CKB stealth address.
 *
 * Uses SHA-256 for the shared secret hash (unlike EVM which uses keccak256):
 *   S = viewing_key * ephemeral_pub  (ECDH)
 *   hashed = SHA-256(S)
 *   stealth_key = (spending_key + hashed) mod n
 *
 * @param spendingKey     Recipient's 32-byte spending private key.
 * @param ephemeralPubKey The 33-byte compressed ephemeral public key from the cell.
 * @param viewingKey      Recipient's 32-byte viewing private key.
 * @returns The 32-byte private key for the stealth address.
 */
export function deriveStealthPrivateKey(
  spendingKey: HexString,
  ephemeralPubKey: HexString,
  viewingKey: HexString,
): HexString {
  // S = viewing_key * ephemeral_pub
  const sharedSecret = secp256k1.getSharedSecret(
    toBytes(viewingKey),
    toBytes(ephemeralPubKey),
    true,
  );

  // SHA-256 hash (NOT keccak256)
  const hashed = sha256(sharedSecret);

  const n = secp256k1.CURVE.n;
  const m = BigInt(spendingKey);
  const s_h = BigInt(toHex(hashed)) % n;
  const stealthPrivKey = (m + s_h) % n;

  const hex = stealthPrivKey.toString(16).padStart(64, '0');
  return `0x${hex}` as HexString;
}
