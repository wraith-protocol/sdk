import { computeSharedSecret, computeViewTag } from './stealth';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress, L } from './scalar';
import { SCHEME_ID } from './constants';
import type { Announcement, MatchedAnnouncement } from './types';
import { hexToBytes } from './utils';

/**
 * Checks whether one Stellar announcement can belong to a recipient.
 *
 * This is view-only detection. It uses the viewing key and spending public key
 * to reconstruct the expected stealth account, but it cannot derive the private
 * scalar needed to spend.
 *
 * @param ephemeralPubKey - 32-byte ephemeral public key from the announcement.
 * @param viewingKey - Recipient's 32-byte viewing seed.
 * @param spendingPubKey - Recipient's 32-byte spending public key.
 * @param viewTag - One-byte view tag from announcement metadata.
 * @returns Match status plus the derived address and scalar details when matched.
 * @throws {Error} If the ephemeral or spending public key is not a valid ed25519 point.
 *
 * @example
 * ```ts
 * import { checkStealthAddress, hexToBytes } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const result = checkStealthAddress(
 *   hexToBytes(announcement.ephemeralPubKey),
 *   keys.viewingKey,
 *   keys.spendingPubKey,
 *   hexToBytes(announcement.metadata)[0],
 * );
 * ```
 *
 * @see {@link scanAnnouncements}
 */
export function checkStealthAddress(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  viewTag: number,
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);

  const computedTag = computeViewTag(sharedSecret);
  if (computedTag !== viewTag) {
    return { isMatch: false, stealthAddress: null, hashScalar: null, stealthPubKeyBytes: null };
  }

  const hScalar = hashToScalar(sharedSecret);

  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
  const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

  return { isMatch: true, stealthAddress, hashScalar: hScalar, stealthPubKeyBytes };
}

/**
 * Scans Stellar stealth announcements and returns the ones a recipient can spend.
 *
 * Use this after fetching Soroban announcements. The spending scalar is required
 * because matched results include the derived stealth private scalar for later
 * transaction signing.
 *
 * @param announcements - Candidate announcements from Soroban events.
 * @param viewingKey - Recipient's 32-byte viewing seed.
 * @param spendingPubKey - Recipient's 32-byte spending public key.
 * @param spendingScalar - Recipient's private spending scalar.
 * @returns Announcements that match the recipient, each with spendable scalar data.
 * @throws {Error} If a matching announcement contains malformed public-key data.
 *
 * @example
 * ```ts
 * import { fetchAnnouncements, scanAnnouncements } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const announcements = await fetchAnnouncements("stellar");
 * const matches = scanAnnouncements(
 *   announcements,
 *   keys.viewingKey,
 *   keys.spendingPubKey,
 *   keys.spendingScalar,
 * );
 * ```
 *
 * @see {@link deriveStealthPrivateScalar}
 */
export function scanAnnouncements(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;

    const metadataBytes = hexToBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    const result = checkStealthAddress(ephPubKey, viewingKey, spendingPubKey, viewTag);

    if (
      result.isMatch &&
      result.stealthAddress === ann.stealthAddress &&
      result.hashScalar !== null &&
      result.stealthPubKeyBytes !== null
    ) {
      const stealthPrivateScalar = (spendingScalar + result.hashScalar) % L;

      matched.push({
        ...ann,
        stealthPrivateScalar,
        stealthPubKeyBytes: result.stealthPubKeyBytes,
      });
    }
  }

  return matched;
}
