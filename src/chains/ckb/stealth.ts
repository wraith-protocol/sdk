import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { toHex, toBytes } from 'viem';
import { blake160 } from './blake';
import type { HexString, GeneratedStealthAddress } from './types';

/**
 * Generates a one-time stealth address for a CKB recipient.
 *
 * Uses secp256k1 ECDH (same curve as EVM) but SHA-256 for shared secret
 * hashing and blake2b for address derivation:
 *   - shared_secret = ECDH(ephemeral_priv, viewing_pub)
 *   - hashed = SHA-256(shared_secret)
 *   - stealth_pub = spending_pub + hashed * G
 *   - pubkey_hash = blake2b(stealth_pub, "ckb-default-hash")[0:20]
 *   - lock_args = ephemeral_pub || pubkey_hash
 *
 * No view tag on CKB — every cell is fully checked during scanning.
 *
 * @param spendingPubKey  Recipient's 33-byte compressed spending public key.
 * @param viewingPubKey   Recipient's 33-byte compressed viewing public key.
 * @param ephemeralPrivateKey  Optional fixed ephemeral key for deterministic testing.
 */
export function generateStealthAddress(
  spendingPubKey: HexString,
  viewingPubKey: HexString,
  ephemeralPrivateKey?: HexString,
): GeneratedStealthAddress {
  const ephPrivKey = ephemeralPrivateKey
    ? toBytes(ephemeralPrivateKey)
    : secp256k1.utils.randomPrivateKey();
  const ephPubKey = secp256k1.getPublicKey(ephPrivKey, true);

  // ECDH shared secret
  const sharedSecret = secp256k1.getSharedSecret(ephPrivKey, toBytes(viewingPubKey), true);

  // SHA-256 hash of shared secret (NOT keccak256 like EVM)
  const hashed = sha256(sharedSecret);

  // Validate scalar
  const n = secp256k1.CURVE.n;
  let secretScalar = BigInt(toHex(hashed)) % n;
  if (secretScalar === 0n) {
    throw new Error('Hashed secret reduced to zero mod n');
  }

  // P_stealth = K_spend + hashed * G
  const K_spend = secp256k1.ProjectivePoint.fromHex(toBytes(spendingPubKey));
  const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(secretScalar);
  const stealthPubKeyPoint = K_spend.add(sharedPoint);
  const stealthPubKeyBytes = stealthPubKeyPoint.toRawBytes(true); // compressed 33 bytes

  // blake160(stealth_pub) = blake2b with CKB personalization, first 20 bytes
  const pubKeyHash = blake160(stealthPubKeyBytes);

  // lock_args = ephemeral_pub (33) || blake160(stealth_pub) (20)
  const lockArgsBytes = new Uint8Array(53);
  lockArgsBytes.set(ephPubKey, 0);
  lockArgsBytes.set(pubKeyHash, 33);

  return {
    stealthPubKey: toHex(stealthPubKeyBytes) as HexString,
    stealthPubKeyHash: toHex(pubKeyHash) as HexString,
    ephemeralPubKey: toHex(ephPubKey) as HexString,
    lockArgs: toHex(lockArgsBytes) as HexString,
  };
}
