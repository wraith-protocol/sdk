import { computeSharedSecret, computeViewTag } from './stealth';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress, L } from './scalar';
import { SCHEME_ID } from './constants';
import type { Announcement, MatchedAnnouncement } from './types';
import { hexToBytes } from './utils';

/**
 * Checks whether a single on-chain announcement belongs to the recipient — without
 * requiring the spending private key.
 *
 * This is the low-level primitive used inside {@link scanAnnouncements}. Call it
 * directly when you need fine-grained control (e.g. streaming announcements one at a
 * time). For batch processing, prefer {@link scanAnnouncements}.
 *
 * The check proceeds in two stages for efficiency:
 * 1. **View-tag filter** — computes `SHA-256("wraith:tag:" || ECDH(viewingKey, R))[0]`
 *    and rejects immediately if it does not match. Eliminates ~255/256 non-matches
 *    without full public-key arithmetic.
 * 2. **Address match** — computes the expected stealth public key via point addition
 *    (`K_spend + s_h·G`) and compares the Stellar encoding to the announcement.
 *
 * This function requires only the viewing key and spending *public* key — the spending
 * scalar is not needed and is never exposed here.
 *
 * @param ephemeralPubKey - 32-byte ephemeral public key from the announcement.
 * @param viewingKey - Recipient's 32-byte ed25519 viewing seed.
 * @param spendingPubKey - Recipient's 32-byte ed25519 spending public key.
 * @param viewTag - The expected view tag byte (first byte of the announcement `metadata`).
 * @returns An object indicating whether the announcement matches, plus the computed
 *   stealth address and hash scalar when it does (all null on a miss).
 *
 * @example
 * ```ts
 * import { checkStealthAddress } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const result = checkStealthAddress(
 *   ephPubKeyBytes,
 *   keys.viewingKey,
 *   keys.spendingPubKey,
 *   announcementViewTag,
 * );
 *
 * if (result.isMatch && result.stealthAddress === ann.stealthAddress) {
 *   // Payment is ours — proceed to derive the spending scalar
 * }
 * ```
 *
 * @see {@link scanAnnouncements} for the higher-level batch scan API
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
 * Scans a list of on-chain announcements and returns those that belong to the recipient,
 * each enriched with the stealth private scalar needed to spend the funds.
 *
 * This is the main entry point for the recipient-side payment detection flow. Pair it
 * with {@link fetchAnnouncements} to get the announcement list.
 *
 * **Key separation:** scanning (detection) requires only `viewingKey` +
 * `spendingPubKey`. Spending additionally requires `spendingScalar`. Pass the scalar
 * only when you need to produce signed transactions.
 *
 * Announcements with a `schemeId` that doesn't match {@link SCHEME_ID} or malformed
 * fields are silently skipped.
 *
 * @param announcements - Array of announcements from the on-chain event log (see
 *   {@link fetchAnnouncements}).
 * @param viewingKey - Recipient's 32-byte ed25519 viewing seed.
 * @param spendingPubKey - Recipient's 32-byte ed25519 spending public key.
 * @param spendingScalar - Recipient's spending private scalar (from
 *   {@link StealthKeys.spendingScalar}). Used to derive `stealthPrivateScalar` for each
 *   match — keep this secret.
 * @returns Array of {@link MatchedAnnouncement} objects, each containing the original
 *   announcement fields plus `stealthPrivateScalar` and `stealthPubKeyBytes`.
 *
 * @example
 * ```ts
 * import {
 *   deriveStealthKeys,
 *   fetchAnnouncements,
 *   scanAnnouncements,
 *   signStellarTransaction,
 * } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const keys = deriveStealthKeys(signatureBytes);
 * const announcements = await fetchAnnouncements('stellar');
 *
 * const matched = scanAnnouncements(
 *   announcements,
 *   keys.viewingKey,
 *   keys.spendingPubKey,
 *   keys.spendingScalar,
 * );
 *
 * for (const match of matched) {
 *   console.log('Found payment to', match.stealthAddress);
 *   // Use match.stealthPrivateScalar to sign transactions
 * }
 * ```
 *
 * @see {@link fetchAnnouncements} to retrieve announcements from the Soroban RPC
 * @see {@link signStellarTransaction} to spend a matched payment
 * @see {@link checkStealthAddress} for the single-announcement variant
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