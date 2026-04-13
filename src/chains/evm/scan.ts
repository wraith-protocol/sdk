import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, toHex, toBytes, getAddress } from "viem";
import { deriveStealthPrivateKey } from "./spend";
import { SCHEME_ID } from "./constants";
import type {
  HexString,
  Announcement,
  MatchedAnnouncement,
} from "./types";

/**
 * Checks whether a single announcement belongs to the recipient.
 *
 * Computes the shared secret from the viewing key and ephemeral public key,
 * uses the view tag for fast filtering, then derives the full stealth address
 * for comparison.
 *
 * @returns The stealth address if it matches, or null.
 */
export function checkStealthAddress(
  ephemeralPubKey: HexString,
  viewingKey: HexString,
  spendingPubKey: HexString,
  viewTag: number
): { isMatch: boolean; stealthAddress: HexString | null } {
  const sharedSecret = secp256k1.getSharedSecret(
    toBytes(viewingKey),
    toBytes(ephemeralPubKey),
    true
  );

  const hashedSecret = keccak256(toHex(sharedSecret));
  const hashedSecretBytes = toBytes(hashedSecret);

  if (hashedSecretBytes[0] !== viewTag) {
    return { isMatch: false, stealthAddress: null };
  }

  const n = secp256k1.CURVE.n;
  const secretScalar = BigInt(hashedSecret) % n;

  const K_spend = secp256k1.ProjectivePoint.fromHex(toBytes(spendingPubKey));
  const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(secretScalar);
  const stealthPubKey = K_spend.add(sharedPoint);

  const uncompressed = stealthPubKey.toRawBytes(false);
  const pubKeyNoPrefix = uncompressed.slice(1);
  const addressHash = keccak256(toHex(pubKeyNoPrefix));
  const stealthAddress = getAddress(
    `0x${addressHash.slice(-40)}`
  ) as HexString;

  return { isMatch: true, stealthAddress };
}

/**
 * Scans a list of on-chain announcements to find those belonging to the recipient.
 *
 * For each matching announcement, also derives the stealth private key.
 *
 * @param announcements  Raw announcements from the ERC-5564 Announcer contract.
 * @param viewingKey     Recipient's 32-byte viewing private key.
 * @param spendingPubKey Recipient's 33-byte compressed spending public key.
 * @param spendingKey    Recipient's 32-byte spending private key (for deriving stealth keys).
 */
export function scanAnnouncements(
  announcements: Announcement[],
  viewingKey: HexString,
  spendingPubKey: HexString,
  spendingKey: HexString
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;

    const metadataBytes = toBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    const result = checkStealthAddress(
      ann.ephemeralPubKey,
      viewingKey,
      spendingPubKey,
      viewTag
    );

    if (
      result.isMatch &&
      result.stealthAddress?.toLowerCase() ===
        ann.stealthAddress.toLowerCase()
    ) {
      const stealthPrivateKey = deriveStealthPrivateKey(
        spendingKey,
        ann.ephemeralPubKey,
        viewingKey
      );

      matched.push({ ...ann, stealthPrivateKey });
    }
  }

  return matched;
}
