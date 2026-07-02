import { ed25519 } from '@noble/curves/ed25519';
import { computeAnnouncementViewTag, computeSharedSecret, computeViewTag } from './stealth';
import { hashToScalar, deriveStealthPubKey, pubKeyToStellarAddress, L } from './scalar';
import { SCHEME_ID, SCHEME_ID_V2 } from './constants';
import type { Announcement, MatchedAnnouncement } from './types';
import { hexToBytes } from './utils';

/**
 * Streaming announcement scanner. Pulls announcements from `source` in windows of
 * `opts.window` (default 64), scans each window, and yields matches immediately.
 *
 * Uses the cheap public view-tag prefilter before the X25519 shared secret:
 *   1. Derive the viewing public key once from the viewing seed
 *   2. View tag quick filter from R_ephemeral || viewing_pubkey
 *   3. Compute shared secret: S = ECDH(viewing_key, R_ephemeral) only for tag hits
 *   4. Compute hash_scalar = SHA-256("wraith:scalar:" || S) mod L
 *   5. Expected stealth pubkey = K_spend + hash_scalar * G
 *   6. Compare with announced stealth address
 * Peak memory is O(window) — never accumulates the full announcement set.
 * Cancellation is clean: breaking out of the `for-await` loop triggers the `finally`
 * block which calls `.return()` on the source iterator, stopping upstream I/O.
 *
 * @param source  Async iterable of announcements (e.g. from {@link fetchAnnouncementsStream}).
 * @param opts.window  Max announcements buffered at once. Smaller = less memory, larger = fewer
 *                     async round-trips to the source. Default: 64.
 */
export async function* scanAnnouncementsStream(
  source: AsyncIterable<Announcement>,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
  opts: { window?: number } = {},
): AsyncGenerator<MatchedAnnouncement> {
  const windowSize = Math.max(1, opts.window ?? 64);
  const iter = source[Symbol.asyncIterator]();

  try {
    while (true) {
      // Prefetch up to windowSize announcements — bounds peak memory to O(window)
      const batch: Announcement[] = [];
      for (let i = 0; i < windowSize; i++) {
        const next = await iter.next();
        if (next.done) break;
        batch.push(next.value);
      }

      if (batch.length === 0) break;

      for (const ann of batch) {
        if (ann.schemeId !== SCHEME_ID && ann.schemeId !== SCHEME_ID_V2) continue;

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
          yield {
            ...ann,
            stealthPrivateScalar,
            stealthPubKeyBytes: result.stealthPubKeyBytes,
          };
        }
      }

      if (batch.length < windowSize) break;
    }
  } finally {
    // Signal upstream to stop I/O when consumer cancels early
    await iter.return?.();
  }
}

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
  const viewingPubKey = ed25519.getPublicKey(viewingKey);
  return checkStealthAddressWithViewingPubKey(
    ephemeralPubKey,
    viewingKey,
    viewingPubKey,
    spendingPubKey,
    viewTag,
  );
}

function checkStealthAddressWithViewingPubKey(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  viewingPubKey: Uint8Array,
  spendingPubKey: Uint8Array,
  viewTag: number,
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  const computedTag = computeAnnouncementViewTag(ephemeralPubKey, viewingPubKey);
  if (computedTag !== viewTag) {
    return { isMatch: false, stealthAddress: null, hashScalar: null, stealthPubKeyBytes: null };
  }

  try {
    return deriveStealthAddressFromAnnouncement(ephemeralPubKey, viewingKey, spendingPubKey);
  } catch {
    return { isMatch: false, stealthAddress: null, hashScalar: null, stealthPubKeyBytes: null };
  }
}

function deriveStealthAddressFromAnnouncement(
  ephemeralPubKey: Uint8Array,
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
): {
  isMatch: boolean;
  stealthAddress: string | null;
  hashScalar: bigint | null;
  stealthPubKeyBytes: Uint8Array | null;
} {
  const sharedSecret = computeSharedSecret(viewingKey, ephemeralPubKey);
  const hScalar = hashToScalar(sharedSecret);

  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
  const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

  return { isMatch: true, stealthAddress, hashScalar: hScalar, stealthPubKeyBytes };
}

/**
 * Scans Stellar stealth announcements and returns the ones a recipient can spend.
 *
 * @deprecated Prefer {@link scanAnnouncementsStream} for memory-efficient streaming.
 * For large announcement sets this loads the full array into memory, which can
 * exhaust TEE memory budgets. This function is kept for backward compatibility.
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
  const viewingPubKey = ed25519.getPublicKey(viewingKey);

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID && ann.schemeId !== SCHEME_ID_V2) continue;

    const metadataBytes = hexToBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    const result = checkStealthAddressWithViewingPubKey(
      ephPubKey,
      viewingKey,
      viewingPubKey,
      spendingPubKey,
      viewTag,
    );

    if (
      result.isMatch &&
      result.stealthAddress === ann.stealthAddress &&
      result.hashScalar !== null &&
      result.stealthPubKeyBytes !== null
    ) {
      const stealthPrivateScalar = (spendingScalar + result.hashScalar) % L;
      if (stealthPrivateScalar <= 0n) continue;

      matched.push({
        ...ann,
        stealthPrivateScalar,
        stealthPubKeyBytes: result.stealthPubKeyBytes,
      });
    }
  }

  return matched;
}

/**
 * Pre-optimization scanner retained for benchmarks and migration analysis.
 *
 * This matches the old Stellar path: every same-scheme announcement pays for
 * X25519 first, computes the legacy shared-secret tag second, and only then
 * compares the announced stealth address.
 */
export function scanAnnouncementsLegacySharedSecretTag(
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

    let sharedSecret: Uint8Array;
    try {
      sharedSecret = computeSharedSecret(viewingKey, ephPubKey);
    } catch {
      continue;
    }

    const computedTag = computeViewTag(sharedSecret);
    if (computedTag !== viewTag) continue;

    const hScalar = hashToScalar(sharedSecret);
    const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
    const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

    if (stealthAddress === ann.stealthAddress) {
      const stealthPrivateScalar = (spendingScalar + hScalar) % L;

      matched.push({
        ...ann,
        stealthPrivateScalar,
        stealthPubKeyBytes,
      });
    }
  }

  return matched;
}
