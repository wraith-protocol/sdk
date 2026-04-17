import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { toHex, toBytes } from 'viem';
import { blake160 } from './blake';
import { deriveStealthPrivateKey } from './spend';
import type { HexString, StealthCell, MatchedStealthCell } from './types';

/**
 * Checks whether a stealth cell belongs to the recipient.
 *
 * CKB stealth cells embed the announcement directly in lock script args:
 *   args[0:33]  = ephemeral public key
 *   args[33:53] = blake160(stealth public key)
 *
 * No view tag optimization — every cell must be fully checked.
 */
export function checkStealthCell(
  lockArgs: HexString,
  viewingKey: HexString,
  spendingPubKey: HexString,
): { isMatch: boolean; stealthPubKeyHash: HexString | null } {
  const argsBytes = toBytes(lockArgs);
  if (argsBytes.length !== 53) {
    return { isMatch: false, stealthPubKeyHash: null };
  }

  const ephPubKeyBytes = argsBytes.slice(0, 33);
  const expectedHash = argsBytes.slice(33, 53);

  // ECDH: shared = viewing_key * ephemeral_pub
  const sharedSecret = secp256k1.getSharedSecret(toBytes(viewingKey), ephPubKeyBytes, true);

  // SHA-256 hash of shared secret
  const hashed = sha256(sharedSecret);

  const n = secp256k1.CURVE.n;
  const secretScalar = BigInt(toHex(hashed)) % n;

  // expected_pub = spending_pub + hashed * G
  const K_spend = secp256k1.ProjectivePoint.fromHex(toBytes(spendingPubKey));
  const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(secretScalar);
  const stealthPubKey = K_spend.add(sharedPoint);
  const stealthPubKeyBytes = stealthPubKey.toRawBytes(true);

  // Compare blake160(expected_pub) with args[33:53]
  const computedHash = blake160(stealthPubKeyBytes);

  const matches = computedHash.every((b, i) => b === expectedHash[i]);

  return {
    isMatch: matches,
    stealthPubKeyHash: matches ? (toHex(computedHash) as HexString) : null,
  };
}

/**
 * Scans stealth cells to find those belonging to the recipient.
 *
 * For each matching cell, derives the stealth private key.
 */
export function scanStealthCells(
  cells: StealthCell[],
  viewingKey: HexString,
  spendingPubKey: HexString,
  spendingKey: HexString,
): MatchedStealthCell[] {
  const matched: MatchedStealthCell[] = [];

  for (const cell of cells) {
    const result = checkStealthCell(cell.lockArgs, viewingKey, spendingPubKey);

    if (result.isMatch) {
      const stealthPrivateKey = deriveStealthPrivateKey(
        spendingKey,
        cell.ephemeralPubKey,
        viewingKey,
      );

      matched.push({ ...cell, stealthPrivateKey });
    }
  }

  return matched;
}
